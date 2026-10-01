import { parseArgs } from "node:util";
import { createHash } from "node:crypto";
import { readFileSync, realpathSync, statSync } from "node:fs";
import {
  basename,
  dirname,
  isAbsolute,
  relative,
  resolve,
  sep,
} from "node:path";

type Attachment = { name: string; path?: string; contentType?: string };
type ImportedExecution = { id: string; attachments?: Attachment[] };
type ImportResponse = {
  duplicate?: boolean;
  executions?: ImportedExecution[];
  error?: string;
};

const { values } = parseArgs({
  options: {
    url: { type: "string" },
    "run-id": { type: "string" },
    report: { type: "string" },
  },
  strict: true,
});

const wait = (ms: number) => new Promise((done) => setTimeout(done, ms));

async function postForm(
  base: URL,
  path: string,
  makeForm: () => FormData,
  extraHeaders: Record<string, string> = {},
): Promise<ImportResponse> {
  for (let attempt = 0; attempt < 5; attempt++) {
    try {
      const response = await fetch(new URL(path, base), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${process.env.QA_UPLOAD_TOKEN}`,
          ...extraHeaders,
        },
        body: makeForm(),
        signal: AbortSignal.timeout(45000),
      });
      if ([502, 503, 504].includes(response.status) && attempt < 4) {
        await wait(1000 * 2 ** attempt);
        continue;
      }
      const body = (await response.json().catch(() => ({
        error: `HTTP ${response.status}`,
      }))) as ImportResponse;
      if (!response.ok) {
        throw Object.assign(
          new Error(body.error || `HTTP ${response.status}`),
          {
            permanent: true,
          },
        );
      }
      return body;
    } catch (error) {
      if ((error as { permanent?: boolean }).permanent || attempt === 4)
        throw error;
      await wait(1000 * 2 ** attempt);
    }
  }
  throw new Error("Upload retries exhausted");
}

function localScreenshotPath(reportDirectory: string, attachment: Attachment) {
  if (!attachment.path)
    throw new Error("Screenshot attachment has no local path");
  const path = realpathSync(resolve(attachment.path));
  const part = relative(reportDirectory, path);
  if (part === ".." || part.startsWith(`..${sep}`) || isAbsolute(part)) {
    throw new Error(
      "Screenshot is outside the report directory; run the uploader where the report and artifacts were generated",
    );
  }
  return path;
}

async function main() {
  if (
    !values.url ||
    !values["run-id"] ||
    !values.report ||
    !process.env.QA_UPLOAD_TOKEN
  )
    throw new Error(
      "Usage: npm run upload -- --url https://your-app --run-id ID --report results.json; set QA_UPLOAD_TOKEN",
    );
  const url = new URL(values.url);
  if (
    url.protocol !== "https:" &&
    !["localhost", "127.0.0.1"].includes(url.hostname)
  )
    throw new Error("Remote uploads require HTTPS");
  const reportPath = realpathSync(resolve(values.report));
  const reportDirectory = dirname(reportPath);
  const data = readFileSync(reportPath);
  if (data.length > 10 * 1024 * 1024) throw new Error("Report exceeds 10 MB");
  JSON.parse(data.toString());

  const runPath = `/api/v1/runs/${encodeURIComponent(values["run-id"])}`;
  const imported = await postForm(url, `${runPath}/imports/playwright`, () => {
    const form = new FormData();
    form.append(
      "report",
      new Blob([data], { type: "application/json" }),
      basename(reportPath),
    );
    return form;
  });
  if (!Array.isArray(imported.executions))
    throw new Error(
      "The dashboard did not return execution IDs for screenshot upload",
    );

  let screenshotsUploaded = 0;
  let screenshotsAlreadyPresent = 0;
  let screenshotsNotCaptured = 0;
  for (const execution of imported.executions) {
    const screenshot = execution.attachments
      ?.filter(
        (item) =>
          item.name === "screenshot" &&
          ["image/png", "image/jpeg", "image/webp"].includes(
            item.contentType || "",
          ),
      )
      .at(-1);
    if (!screenshot) {
      screenshotsNotCaptured++;
      continue;
    }
    const path = localScreenshotPath(reportDirectory, screenshot);
    const size = statSync(path).size;
    if (size > 2 * 1024 * 1024)
      throw new Error("Screenshot exceeds the dashboard's 2 MB upload limit");
    const bytes = readFileSync(path);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const extension =
      screenshot.contentType === "image/jpeg"
        ? "jpg"
        : screenshot.contentType === "image/webp"
          ? "webp"
          : "png";
    const uploaded = await postForm(
      url,
      `/api/v1/executions/${encodeURIComponent(execution.id)}/evidence`,
      () => {
        const form = new FormData();
        form.append(
          "screenshot",
          new Blob([bytes], { type: screenshot.contentType }),
          `playwright-${hash}.${extension}`,
        );
        return form;
      },
      { "x-qa-evidence-sha256": hash },
    );
    if (uploaded.duplicate) screenshotsAlreadyPresent++;
    else screenshotsUploaded++;
  }

  console.log(
    JSON.stringify(
      {
        import: imported.duplicate ? "already present" : "created",
        executions: imported.executions.length,
        screenshotsUploaded,
        screenshotsAlreadyPresent,
        screenshotsNotCaptured,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "Upload failed");
  process.exitCode = 1;
});
