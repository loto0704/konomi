import { defineConfig } from "drizzle-kit";

// マイグレーションの SQL を作るだけに使う。適用は Wrangler（wrangler d1 migrations apply）で行う
export default defineConfig({
  dialect: "sqlite",
  schema: "./src/db/schema.ts",
  out: "./migrations",
});
