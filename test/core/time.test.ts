import { describe, expect, it } from "vitest";
import { formatShort, nextLocalTime, zonedToUnix } from "../../src/core/time";

const utc = (iso: string) => Date.parse(iso) / 1000;

describe("タイムゾーンの計算", () => {
  it("Asia/Tokyo の現地時刻を UNIX 秒にする", () => {
    expect(zonedToUnix({ year: 2026, month: 11, day: 20, hour: 18, minute: 0 }, "Asia/Tokyo")).toBe(
      utc("2026-11-20T09:00:00Z"),
    );
  });

  it("夏時間のあるタイムゾーンでも正しい", () => {
    // 2026-07-01 は夏時間（UTC-4）
    expect(
      zonedToUnix({ year: 2026, month: 7, day: 1, hour: 9, minute: 30 }, "America/New_York"),
    ).toBe(utc("2026-07-01T13:30:00Z"));
  });

  it("今日の時刻がまだなら今日、過ぎていれば翌日", () => {
    const morning = utc("2026-11-20T01:00:00Z"); // 東京 10:00
    expect(nextLocalTime(morning, "Asia/Tokyo", "18:00")).toBe(utc("2026-11-20T09:00:00Z"));
    const night = utc("2026-11-20T10:00:00Z"); // 東京 19:00
    expect(nextLocalTime(night, "Asia/Tokyo", "18:00")).toBe(utc("2026-11-21T09:00:00Z"));
  });

  it("月末をまたいでも翌日になる", () => {
    const night = utc("2026-11-30T12:00:00Z"); // 東京 12/1 にはなっていない 21:00
    expect(nextLocalTime(night, "Asia/Tokyo", "18:00")).toBe(utc("2026-12-01T09:00:00Z"));
  });

  it("「月/日 時:分」で表示する", () => {
    expect(formatShort(utc("2026-11-20T09:05:00Z"), "Asia/Tokyo")).toBe("11/20 18:05");
  });
});
