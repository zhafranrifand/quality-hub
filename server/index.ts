import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { createApp } from "./app.js";
if (existsSync(".env")) process.loadEnvFile(".env");
const { OWNER_EMAIL, OWNER_PASSWORD_HASH } = process.env;
if (!OWNER_EMAIL || !OWNER_PASSWORD_HASH)
  throw new Error(
    "Set OWNER_EMAIL and OWNER_PASSWORD_HASH. Run npm run password to generate a hash.",
  );
const { app, db } = createApp({
  dataDir: resolve(process.env.DATA_DIR || "data"),
  ownerEmail: OWNER_EMAIL,
  passwordHash: OWNER_PASSWORD_HASH,
  publicOrigin: process.env.PUBLIC_ORIGIN,
  production: process.env.NODE_ENV === "production",
});
const server = app.listen(Number(process.env.PORT || 3000), "0.0.0.0", () =>
  console.log(`Quality Hub listening on port ${process.env.PORT || 3000}`),
);
const stop = () =>
  server.close(() => {
    db.sqlite.close();
    process.exit(0);
  });
process.on("SIGTERM", stop);
process.on("SIGINT", stop);
