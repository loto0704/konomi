import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  MIN_DEADLINE_LEAD_SECONDS,
  prepareManualDelivery,
  publishRound,
  resolveTargetChannel,
  startManualChannelRound,
} from "../../src/core/delivery";
import { rounds, settings, topics } from "../../src/db/schema";
import { db, makeRound, makeTopic } from "../helpers/db";
import { FakeMessenger } from "../helpers/messenger";

const NOW = 1_800_000_000;

describe("投稿先のチャンネル", () => {
  it("設定があればそちら、なければ実行したチャンネル", () => {
    expect(resolveTargetChannel("C0SET", "C0HERE")).toBe("C0SET");
    expect(resolveTargetChannel(null, "C0HERE")).toBe("C0HERE");
  });
});

describe("手動配信のモーダルの中身", () => {
  it("未使用のお題が先に並び、締切の初期値は次の 18:00（東京）", async () => {
    const used = await makeTopic({ question: "使用済み", lastUsedAt: NOW - 100 });
    const form = await prepareManualDelivery(db(), NOW);
    expect(form.topics.at(-1)?.id).toBe(used.topic.id);
    expect(form.timezone).toBe("Asia/Tokyo");
    expect(form.settingsChannelId).toBeNull();
    // NOW は 2027-01-15T08:00:00Z = 東京 17:00 → 同じ日の 18:00
    expect(form.defaultDeadlineAt).toBe(Date.parse("2027-01-15T09:00:00Z") / 1000);
  });

  it("無効なお題と自由記述のお題は出さない", async () => {
    const inactive = await makeTopic({ question: "無効", isActive: false });
    const text = await makeTopic({ question: "自由記述", answerFormat: "text" });
    const form = await prepareManualDelivery(db(), NOW);
    const ids = form.topics.map((t) => t.id);
    expect(ids).not.toContain(inactive.topic.id);
    expect(ids).not.toContain(text.topic.id);
  });
});

describe("手動配信の作成", () => {
  it("受付中で作り、お題の記名設定を配信に写し、last_used_at を更新する", async () => {
    const { topic } = await makeTopic({ resultVisibility: "named" });
    const result = await startManualChannelRound(db(), {
      topicId: topic.id,
      channelId: "C0HERE",
      deadlineAt: NOW + 3600,
      now: NOW,
    });
    if (!result.ok) throw new Error(result.error);
    expect(result.round).toMatchObject({
      topicId: topic.id,
      type: "channel",
      resultVisibility: "named",
      channelId: "C0HERE",
      deadlineAt: NOW + 3600,
      status: "open",
      messageTs: null,
      createdAt: NOW,
    });
    const [after] = await db().select().from(topics).where(eq(topics.id, topic.id));
    expect(after?.lastUsedAt).toBe(NOW);
  });

  it("無効・選択肢が足りない・存在しないお題は topic_unavailable", async () => {
    const inactive = await makeTopic({ isActive: false });
    const oneChoice = await makeTopic({}, ["犬"]);
    for (const topicId of [inactive.topic.id, oneChoice.topic.id, "nope"]) {
      const r = await startManualChannelRound(db(), {
        topicId,
        channelId: "C0",
        deadlineAt: null,
        now: NOW,
      });
      expect(r).toEqual({ ok: false, error: "topic_unavailable" });
    }
  });

  it("締切が5分以内や過去なら deadline_past", async () => {
    const { topic } = await makeTopic();
    const r = await startManualChannelRound(db(), {
      topicId: topic.id,
      channelId: "C0",
      deadlineAt: NOW + MIN_DEADLINE_LEAD_SECONDS - 1,
      now: NOW,
    });
    expect(r).toEqual({ ok: false, error: "deadline_past" });
  });

  it("受付中の無期限の配信が上限に達していれば unlimited_limit", async () => {
    await db().update(settings).set({ maxOpenUnlimited: 1 });
    const { topic } = await makeTopic();
    await makeRound(topic.id, { deadlineAt: null });
    const r = await startManualChannelRound(db(), {
      topicId: topic.id,
      channelId: "C0",
      deadlineAt: null,
      now: NOW,
    });
    expect(r).toEqual({ ok: false, error: "unlimited_limit" });
    // 締切つきなら上限に関係なく作れる
    const ok = await startManualChannelRound(db(), {
      topicId: topic.id,
      channelId: "C0",
      deadlineAt: NOW + 3600,
      now: NOW,
    });
    expect(ok.ok).toBe(true);
    await db().update(settings).set({ maxOpenUnlimited: 10 });
  });
});

describe("配信の投稿", () => {
  it("投稿して ts を記録し、2回目は投稿しない", async () => {
    const { topic } = await makeTopic({ question: "朝型？夜型？" });
    const round = await makeRound(topic.id, { messageTs: null, deadlineAt: NOW + 60 });
    const messenger = new FakeMessenger();

    expect((await publishRound(db(), messenger, round.id)).result).toBe("posted");
    expect((await publishRound(db(), messenger, round.id)).result).toBe("already_posted");
    expect(messenger.posts).toEqual([
      {
        roundId: round.id,
        channelId: "C0CHANNEL",
        question: "朝型？夜型？",
        deadlineAt: NOW + 60,
        timezone: "Asia/Tokyo",
      },
    ]);
    const [after] = await db().select().from(rounds).where(eq(rounds.id, round.id));
    expect(after?.messageTs).toBe(`ts-${round.id}`);
  });

  it("投稿に失敗したら、誰も回答できない配信を残さない", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id, { messageTs: null });
    const messenger = new FakeMessenger();
    messenger.fail = true;

    expect((await publishRound(db(), messenger, round.id)).result).toBe("failed");
    const rows = await db().select().from(rounds).where(eq(rounds.id, round.id));
    expect(rows).toEqual([]);
  });
});
