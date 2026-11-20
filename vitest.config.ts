import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-plugin";
import { defineConfig } from "vitest/config";

export default defineConfig(async () => {
  // テストでは最上位（手元用）の設定で Worker を動かし、ローカルの D1 に migrations/ を当てる
  const migrations = await readD1Migrations("./migrations");
  return {
    plugins: [
      cloudflareTest({
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            SLACK_BOT_TOKEN: "xoxb-test",
            SLACK_SIGNING_SECRET: "test-signing-secret",
            SLACK_CLIENT_ID: "test-client-id",
            SLACK_CLIENT_SECRET: "test-client-secret",
            SESSION_SECRET: "test-session-secret",
          },
        },
      }),
    ],
    test: {
      setupFiles: ["./test/apply-migrations.ts"],
    },
  };
});
