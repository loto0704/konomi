import { createMiddleware } from "hono/factory";
import { type Config, ConfigError, loadConfig } from "./config";
import { log } from "./log";

/** Hono アプリ全体の型。config は withConfig を通ったルートでだけ使える */
export type AppEnv = {
  Bindings: Env;
  Variables: { config: Config };
};

/**
 * 設定値を検証して c.var.config に入れる。
 * 不足や誤りがあれば、名前と理由だけをログに出して 500 を返す（値は出さない）。
 */
export const withConfig = createMiddleware<AppEnv>(async (c, next) => {
  try {
    c.set("config", loadConfig(c.env));
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    log.error("config_invalid", {
      issues: err.issues.map((i) => `${i.name}:${i.reason}`).join(","),
    });
    return c.text("Server misconfigured", 500);
  }
  await next();
});
