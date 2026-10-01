import {
  mkdirSync,
  mkdtempSync,
  existsSync,
  readdirSync,
  createWriteStream,
  readFileSync,
  renameSync,
  rmdirSync,
  rmSync,
  statSync,
} from "node:fs";
import { dirname, join, resolve } from "node:path";
import { pipeline } from "node:stream/promises";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import yauzl from "yauzl";
import Database from "better-sqlite3";
export async function restoreBackup(archive: string, destination: string) {
  const target = resolve(destination);
  if (existsSync(target) && readdirSync(target).length)
    throw new Error(
      "Restore destination must be empty. Stop the app and restore into a NEW directory.",
    );
  mkdirSync(dirname(target), { recursive: true });
  const staging = mkdtempSync(join(dirname(target), ".quality-hub-restore-"));
  try {
    await new Promise<void>((accept, reject) => {
      yauzl.open(archive, { lazyEntries: true }, (error, zip) => {
        if (error || !zip) return reject(error);
        let total = 0;
        const seen = new Set<string>();
        zip.on("error", reject);
        zip.on("end", accept);
        zip.on("entry", async (entry) => {
          try {
            const name = entry.fileName;
            if (name === "screenshots/") {
              mkdirSync(join(staging, "screenshots"), { recursive: true });
              zip.readEntry();
              return;
            }
            if (
              !/^(manifest\.json|quality\.sqlite|screenshots\/[a-f0-9-]+\.webp)$/.test(
                name,
              ) ||
              seen.has(name)
            )
              throw new Error("Unexpected or duplicate archive entry");
            seen.add(name);
            total += entry.uncompressedSize;
            if (total > 500000000) throw new Error("Backup exceeds 500 MB");
            mkdirSync(dirname(join(staging, name)), { recursive: true });
            const stream = await new Promise<NodeJS.ReadableStream>((r, j) =>
              zip.openReadStream(entry, (err, s) =>
                err || !s ? j(err) : r(s),
              ),
            );
            await pipeline(
              stream,
              createWriteStream(join(staging, name), { flags: "wx" }),
            );
            zip.readEntry();
          } catch (e) {
            zip.close();
            reject(e);
          }
        });
        zip.readEntry();
      });
    });
    const manifest = JSON.parse(
      readFileSync(join(staging, "manifest.json"), "utf8"),
    );
    if (manifest.format !== "quality-hub" || manifest.version !== 1)
      throw new Error("Unsupported backup format");
    const database = new Database(join(staging, "quality.sqlite"));
    try {
      if (
        database.pragma("integrity_check", { simple: true }) !== "ok" ||
        (database.pragma("foreign_key_check") as unknown[]).length
      )
        throw new Error("Backup database failed integrity checks");
      const files = database
        .prepare("SELECT path,size FROM evidence WHERE path IS NOT NULL")
        .all() as { path: string; size: number }[];
      for (const f of files)
        if (
          !/^[a-f0-9-]+\.webp$/.test(f.path) ||
          !existsSync(join(staging, "screenshots", f.path)) ||
          statSync(join(staging, "screenshots", f.path)).size !== f.size
        )
          throw new Error("Missing or inconsistent screenshot");
      database.exec("DELETE FROM sessions; DELETE FROM tokens;");
    } finally {
      database.close();
    }
    mkdirSync(join(staging, "screenshots"), { recursive: true });
    if (existsSync(target)) rmdirSync(target);
    renameSync(staging, target);
  } catch (e) {
    rmSync(staging, { recursive: true, force: true });
    throw e;
  }
}
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  const { values } = parseArgs({
    options: { from: { type: "string" }, to: { type: "string" } },
  });
  if (!values.from || !values.to) {
    console.error(
      "Usage: npm run restore -- --from backup.zip --to NEW_DATA_DIR",
    );
    process.exitCode = 1;
  } else
    restoreBackup(values.from, values.to)
      .then(() =>
        console.log(
          "Backup restored; configure DATA_DIR and restart. Upload tokens must be recreated.",
        ),
      )
      .catch((e) => {
        console.error(e.message);
        process.exitCode = 1;
      });
}
