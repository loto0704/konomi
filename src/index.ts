import { Hono } from "hono";

export const app = new Hono<{ Bindings: Env }>();

/** 死活確認。DB には触れない */
app.get("/healthz", (c) => c.text("ok"));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;
