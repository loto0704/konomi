import { Hono } from "hono";
import type { AppEnv } from "./app-env";
import { slackRoutes } from "./slack/routes";

export const app = new Hono<AppEnv>();

/** 死活確認。DB にも設定値にも触れない */
app.get("/healthz", (c) => c.text("ok"));

app.route("/slack", slackRoutes);

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
