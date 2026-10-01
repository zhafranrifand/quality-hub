import {
  readdirSync,
  statSync,
  statfsSync,
  mkdirSync,
  writeFileSync,
  unlinkSync,
  copyFileSync,
  mkdtempSync,
  createWriteStream,
  rmSync,
} from "node:fs";
import { join, resolve, basename } from "node:path";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import Database from "better-sqlite3";
import sharp from "sharp";
import archiver from "archiver";
import type { Store } from "./db.js";
import { evidence } from "./schema.js";
const backups = new WeakSet<Store>();
export const backupRunning = (db: Store) => backups.has(db);
const sizeOf = (dir: string): number =>
  readdirSync(dir, { withFileTypes: true }).reduce(
    (n, e) =>
      n +
      (e.isDirectory()
        ? sizeOf(join(dir, e.name))
        : e.isFile()
          ? statSync(join(dir, e.name)).size
          : 0),
    0,
  );
export function storageInfo(db: Store) {
  const fs = statfsSync(db.dir);
  return {
    used: sizeOf(db.dir),
    capacity: Math.min(
      Number(process.env.VOLUME_CAPACITY_BYTES || 500000000),
      fs.blocks * fs.bsize,
    ),
    available: fs.bavail * fs.bsize,
    screenshotBytes: sizeOf(join(db.dir, "screenshots")),
    screenshotQuota: 100 * 1024 * 1024,
  };
}
export function assertStorage(db: Store, additionalBytes = 0) {
  const s = storageInfo(db);
  if (
    s.used + additionalBytes >= s.capacity * 0.8 ||
    s.available < additionalBytes + 5 * 1024 * 1024
  )
    throw Object.assign(
      new Error(
        "Storage is at its safe limit. Export a backup and remove selected evidence before uploading.",
      ),
      { status: 507 },
    );
}
export async function saveScreenshot(
  db: Store,
  executionId: string,
  buffer: Buffer,
  originalName: string,
) {
  if (buffer.length > 2 * 1024 * 1024)
    throw Object.assign(new Error("Screenshot exceeds 2 MB"), { status: 413 });
  let output: Buffer;
  try {
    const img = sharp(buffer, { limitInputPixels: 20000000, animated: false });
    const metadata = await img.metadata();
    if (!["png", "jpeg", "webp"].includes(metadata.format || ""))
      throw new Error("format");
    output = await img.webp({ quality: 85 }).toBuffer();
  } catch {
    throw Object.assign(
      new Error(
        "Upload a valid PNG, JPEG, or WebP image (up to 20 megapixels).",
      ),
      { status: 400 },
    );
  }
  if (output.length > 2 * 1024 * 1024)
    throw Object.assign(new Error("Decoded screenshot exceeds 2 MB"), {
      status: 413,
    });
  assertStorage(db, output.length);
  const info = storageInfo(db);
  if (info.screenshotBytes + output.length > info.screenshotQuota)
    throw Object.assign(
      new Error("Screenshot storage quota reached (100 MB)."),
      { status: 507 },
    );
  const key = randomUUID(),
    path = key + ".webp";
  const row = {
    id: key,
    executionId,
    name: basename(originalName).slice(0, 200),
    path,
    mime: "image/webp",
    size: output.length,
    createdAt: Date.now(),
  };
  writeFileSync(join(db.dir, "screenshots", path), output, { flag: "wx" });
  try {
    db.insert(evidence, row);
  } catch (e) {
    unlinkSync(join(db.dir, "screenshots", path));
    throw e;
  }
  return row;
}
export async function createBackup(db: Store) {
  if (backups.has(db))
    throw Object.assign(new Error("A backup is already running"), {
      status: 409,
    });
  backups.add(db);
  const dir = mkdtempSync(join(tmpdir(), "quality-hub-backup-"));
  const cleanup = () => rmSync(dir, { recursive: true, force: true });
  try {
    const snapshot = join(dir, "quality.sqlite");
    await db.sqlite.backup(snapshot);
    const copy = new Database(snapshot);
    copy.pragma("journal_mode = DELETE");
    copy.exec("DELETE FROM sessions; DELETE FROM tokens;");
    const files = copy
      .prepare("SELECT path FROM evidence WHERE path IS NOT NULL")
      .all() as { path: string }[];
    copy.close();
    mkdirSync(join(dir, "screenshots"));
    for (const file of files) {
      if (!/^[a-f0-9-]+\.webp$/.test(file.path))
        throw new Error("Unsafe evidence filename");
      copyFileSync(
        join(db.dir, "screenshots", file.path),
        join(dir, "screenshots", file.path),
      );
    }
    writeFileSync(
      join(dir, "manifest.json"),
      JSON.stringify({
        format: "quality-hub",
        version: 1,
        createdAt: new Date().toISOString(),
        credentialsIncluded: false,
      }),
    );
    const path = join(dir, "backup.zip");
    await new Promise<void>((resolve, reject) => {
      const stream = createWriteStream(path),
        zip = archiver("zip", { zlib: { level: 6 } });
      stream.on("close", resolve);
      stream.on("error", reject);
      zip.on("error", reject);
      zip.pipe(stream);
      zip.file(snapshot, { name: "quality.sqlite" });
      zip.file(join(dir, "manifest.json"), { name: "manifest.json" });
      zip.directory(join(dir, "screenshots"), "screenshots");
      void zip.finalize();
    });
    return { path, cleanup };
  } catch (e) {
    cleanup();
    throw e;
  } finally {
    backups.delete(db);
  }
}
