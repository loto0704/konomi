import { applyD1Migrations, env } from "cloudflare:test";

// 各テストファイルの前に、ローカルの D1 へマイグレーションを当てる（適用済みのものは飛ばされる）
await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
