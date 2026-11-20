import { exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

describe("GET /healthz", () => {
  it("200 と ok を返す", async () => {
    const res = await exports.default.fetch("http://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.text()).toBe("ok");
  });

  it("知らないパスは 404", async () => {
    const res = await exports.default.fetch("http://example.com/no-such-path");
    expect(res.status).toBe(404);
  });
});
