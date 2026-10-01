import { defineConfig } from "drizzle-kit";
export default defineConfig({
  schema: "./server/schema.ts",
  out: "./migrations",
  dialect: "sqlite",
});
