/**
 * Cron Triggers（5分おき）の入口。今は締切を過ぎた配信の終了と結果の投稿だけを行う。
 * 定期配信（ステップ5）もここから呼ぶ。
 */

import { ConfigError, loadConfig } from "./config";
import { closeDueRounds } from "./core/closing";
import { createDb } from "./db/client";
import { log } from "./log";
import { SlackApiError, SlackClient } from "./slack/api";

export async function runScheduled(env: Env, now: number): Promise<void> {
  let config: ReturnType<typeof loadConfig>;
  try {
    config = loadConfig(env);
  } catch (err) {
    if (!(err instanceof ConfigError)) throw err;
    log.error("config_invalid", {
      issues: err.issues.map((i) => `${i.name}:${i.reason}`).join(","),
    });
    return;
  }

  const db = createDb(env.DB);
  const slack = new SlackClient(config.slackBotToken, config.appBaseUrl);
  const report = await closeDueRounds(db, slack, now);
  for (const f of report.failed) {
    log.error("result_post_failed", {
      round: f.roundId,
      code: f.error instanceof SlackApiError ? f.error.code : "exception",
    });
  }
  if (report.closed > 0) {
    log.info("due_rounds_closed", {
      closed: report.closed,
      posted: report.posted,
      failed: report.failed.length,
    });
  }
}
