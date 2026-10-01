import { TextDecoder } from "node:util";
import { parseGherkinManifest, type GherkinManifestEntry } from "../scripts/gherkin-manifest.js";

export type GithubSourceConfig = {
  repository: string;
  branch: string;
  featureRoot: string;
  token?: string;
  browser?: string;
};

export type GithubManifest = {
  repository: string;
  branch: string;
  featureRoot: string;
  commitSha: string;
  browser: string;
  files: number;
  scenarios: GherkinManifestEntry[];
};

export class GithubSourceError extends Error {
  status = 502;
  constructor(message: string) {
    super(message);
    this.name = "GithubSourceError";
  }
}

type GithubTreeEntry = {
  path: string;
  type: string;
  mode: string;
  sha: string;
  size?: number;
};

const maxFeatureFiles = 50;
const maxFeatureBytes = 48 * 1024;
const maxManifestBytes = 200 * 1024;
const maxFeatureFileBytes = 24 * 1024;

function validateSource(source: GithubSourceConfig) {
  const [owner, repo, ...rest] = source.repository.split("/");
  if (
    !owner ||
    !repo ||
    rest.length ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(owner) ||
    !/^[A-Za-z0-9_.-]{1,100}$/.test(repo)
  )
    throw new GithubSourceError(
      "GITHUB_REPOSITORY must use the owner/repository format.",
    );
  const branch = source.branch.trim();
  if (!branch || branch.length > 255 || branch.startsWith("-") || branch.includes(".."))
    throw new GithubSourceError("GITHUB_BRANCH is invalid.");
  const featureRoot = source.featureRoot
    .replaceAll("\\", "/")
    .replace(/^\/+|\/+$/g, "");
  if (
    !featureRoot ||
    featureRoot.split("/").some((part) => !part || part === "." || part === "..")
  )
    throw new GithubSourceError("GITHUB_FEATURE_ROOT must be a relative repository path.");
  return { owner, repo, branch, featureRoot };
}

export async function loadGithubManifest(
  source: GithubSourceConfig,
  fetcher: typeof fetch = fetch,
): Promise<GithubManifest> {
  const { owner, repo, branch, featureRoot } = validateSource(source);
  const base = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}`;
  const headers: Record<string, string> = {
    Accept: "application/vnd.github+json",
    "X-GitHub-Api-Version": "2022-11-28",
    "User-Agent": "quality-hub-repository-sync",
  };
  if (source.token) headers.Authorization = `Bearer ${source.token}`;

  const getJson = async <T>(url: string): Promise<T> => {
    let response: Response;
    try {
      response = await fetcher(url, {
        headers,
        signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new GithubSourceError("Could not reach GitHub. Try the sync again.");
    }
    if (!response.ok) {
      if (response.status === 404)
        throw new GithubSourceError(
          "GitHub could not find this repository or branch. For a private repository, configure a repository-limited Contents read token in Railway.",
        );
      if (response.status === 401 || response.status === 403)
        throw new GithubSourceError(
          "GitHub denied access. Check the token, repository selection, and Contents read permission.",
        );
      if (response.status === 429)
        throw new GithubSourceError("GitHub rate-limited the sync. Try again later.");
      throw new GithubSourceError(`GitHub returned HTTP ${response.status}.`);
    }
    return (await response.json()) as T;
  };

  const commit = await getJson<{
    sha: string;
    commit?: { tree?: { sha?: string } };
  }>(`${base}/commits/${encodeURIComponent(branch)}`);
  const commitSha = commit.sha;
  const treeSha = commit.commit?.tree?.sha;
  if (!commitSha || !treeSha)
    throw new GithubSourceError("GitHub returned an incomplete commit record.");
  const tree = await getJson<{ truncated?: boolean; tree?: GithubTreeEntry[] }>(
    `${base}/git/trees/${encodeURIComponent(treeSha)}?recursive=1`,
  );
  if (tree.truncated)
    throw new GithubSourceError(
      "The repository tree is too large to sync safely in one request.",
    );
  const prefix = `${featureRoot}/`;
  const files = (tree.tree || [])
    .filter(
      (entry) =>
        entry.type === "blob" &&
        entry.mode === "100644" &&
        entry.path.startsWith(prefix) &&
        entry.path.endsWith(".feature"),
    )
    .sort((a, b) => a.path.localeCompare(b.path));
  if (!files.length)
    throw new GithubSourceError(
      `No .feature files were found under ${featureRoot} on ${branch}.`,
    );
  if (files.length > maxFeatureFiles)
    throw new GithubSourceError(
      `Found ${files.length} feature files; the sync limit is ${maxFeatureFiles}.`,
    );
  if (files.some((file) => !Number.isSafeInteger(file.size) || file.size! < 0))
    throw new GithubSourceError("GitHub returned invalid feature file metadata.");
  const totalSize = files.reduce((sum, file) => sum + file.size!, 0);
  if (files.some((file) => file.size! > maxFeatureFileBytes) || totalSize > maxFeatureBytes)
    throw new GithubSourceError(
      "Feature files exceed the repository sync size limit (24 KB per file, 48 KB total).",
    );

  const decoder = new TextDecoder("utf-8", { fatal: true });
  const inputs = await Promise.all(
    files.map(async (file) => {
      const blob = await getJson<{ encoding: string; content: string }>(
        `${base}/git/blobs/${encodeURIComponent(file.sha)}`,
      );
      if (blob.encoding !== "base64")
        throw new GithubSourceError(`GitHub returned an unsupported encoding for ${file.path}.`);
      let sourceText: string;
      try {
        sourceText = decoder.decode(Buffer.from(blob.content, "base64"));
      } catch {
        throw new GithubSourceError(`${file.path} is not valid UTF-8 text.`);
      }
      if (Buffer.byteLength(sourceText, "utf8") > maxFeatureFileBytes)
        throw new GithubSourceError(`${file.path} exceeds the 24 KB feature-file limit.`);
      return { relativePath: file.path, source: sourceText };
    }),
  );
  if (
    inputs.reduce((sum, input) => sum + Buffer.byteLength(input.source, "utf8"), 0) >
    maxFeatureBytes
  )
    throw new GithubSourceError("Feature files exceed the 48 KB total sync limit.");
  let scenarios: GherkinManifestEntry[];
  try {
    scenarios = parseGherkinManifest(inputs);
  } catch (error) {
    const message = error instanceof Error ? error.message : "Invalid Gherkin feature files.";
    throw new GithubSourceError(message);
  }
  if (!scenarios.length)
    throw new GithubSourceError("No tagged Gherkin scenarios were found.");
  if (Buffer.byteLength(JSON.stringify(scenarios), "utf8") > maxManifestBytes)
    throw new GithubSourceError("The parsed scenario manifest exceeds the 200 KB sync limit.");

  return {
    repository: `${owner}/${repo}`,
    branch,
    featureRoot,
    commitSha,
    browser: source.browser || "chromium",
    files: files.length,
    scenarios,
  };
}
