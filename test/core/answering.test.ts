import { and, eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { checkCanOpenAnswer, submitAnswer } from "../../src/core/answering";
import type { Directory } from "../../src/core/ports";
import { answers, settings, userPreferences } from "../../src/db/schema";
import { db, makeRound, makeTopic } from "../helpers/db";

const NOW = 1_800_000_000;

const directory = (guests: string[] = []): Directory & { calls: number } => ({
  calls: 0,
  async isGuest(userId) {
    this.calls++;
    return guests.includes(userId);
  },
});

async function setup(roundOverrides = {}) {
  const { topic, choices } = await makeTopic();
  const round = await makeRound(topic.id, { deadlineAt: NOW + 3600, ...roundOverrides });
  const [dog, cat] = choices;
  if (!dog || !cat) throw new Error("no choices");
  return { topic, round, dog, cat };
}

describe("回答モーダルを開く前の確認", () => {
  it("受付中なら、お題と選択肢と前回の回答を返す", async () => {
    const { round, dog } = await setup();
    await submitAnswer(db(), directory(), {
      roundId: round.id,
      userId: "U1",
      choiceId: dog.id,
      now: NOW,
    });
    const r = await checkCanOpenAnswer(db(), { roundId: round.id, userId: "U1", now: NOW });
    if (!r.ok) throw new Error(r.reason);
    expect(r.context.choices.map((c) => c.label)).toEqual(["犬", "猫"]);
    expect(r.context.current?.choiceId).toBe(dog.id);
    expect(r.context.timezone).toBe("Asia/Tokyo");
  });

  it("締切後・終了・存在しない配信は断る", async () => {
    const { round } = await setup();
    expect(
      await checkCanOpenAnswer(db(), { roundId: round.id, userId: "U1", now: NOW + 3600 }),
    ).toEqual({ ok: false, reason: "closed" });
    const closed = await setup({ status: "closed" });
    expect(
      await checkCanOpenAnswer(db(), { roundId: closed.round.id, userId: "U1", now: NOW }),
    ).toEqual({ ok: false, reason: "closed" });
    expect(await checkCanOpenAnswer(db(), { roundId: 999_999, userId: "U1", now: NOW })).toEqual({
      ok: false,
      reason: "not_found",
    });
  });

  it("無期限の配信は受け付ける", async () => {
    const { round } = await setup({ deadlineAt: null });
    const r = await checkCanOpenAnswer(db(), { roundId: round.id, userId: "U1", now: NOW * 2 });
    expect(r.ok).toBe(true);
  });

  it("オプトアウトした人と、管理者が除外した人は断る", async () => {
    const { round } = await setup();
    await db()
      .insert(userPreferences)
      .values([
        { userId: "U_OUT", optedOut: true },
        { userId: "U_EX", excludedByAdmin: true },
      ]);
    expect(
      await checkCanOpenAnswer(db(), { roundId: round.id, userId: "U_OUT", now: NOW }),
    ).toEqual({ ok: false, reason: "opted_out" });
    expect(await checkCanOpenAnswer(db(), { roundId: round.id, userId: "U_EX", now: NOW })).toEqual(
      { ok: false, reason: "excluded" },
    );
  });
});

describe("回答の送信", () => {
  it("1人1回答で、締切までは上書きできる", async () => {
    const { round, dog, cat } = await setup();
    const dir = directory();
    const first = await submitAnswer(db(), dir, {
      roundId: round.id,
      userId: "U1",
      choiceId: dog.id,
      now: NOW,
    });
    expect(first).toEqual({ ok: true, roundId: round.id });
    await submitAnswer(db(), dir, {
      roundId: round.id,
      userId: "U1",
      choiceId: cat.id,
      now: NOW + 10,
    });
    const rows = await db()
      .select()
      .from(answers)
      .where(and(eq(answers.roundId, round.id), eq(answers.userId, "U1")));
    expect(rows).toEqual([
      { roundId: round.id, userId: "U1", choiceId: cat.id, answeredAt: NOW, updatedAt: NOW + 10 },
    ]);
  });

  it("締切を過ぎた送信は保存しない", async () => {
    const { round, dog } = await setup();
    const r = await submitAnswer(db(), directory(), {
      roundId: round.id,
      userId: "U1",
      choiceId: dog.id,
      now: NOW + 3600,
    });
    expect(r).toEqual({ ok: false, reason: "closed" });
    expect(await db().select().from(answers).where(eq(answers.roundId, round.id))).toEqual([]);
  });

  it("別のお題の選択肢は invalid_choice", async () => {
    const { round } = await setup();
    const other = await makeTopic({}, ["A", "B"]);
    const r = await submitAnswer(db(), directory(), {
      roundId: round.id,
      userId: "U1",
      choiceId: other.choices[0]?.id ?? 0,
      now: NOW,
    });
    expect(r).toEqual({ ok: false, reason: "invalid_choice" });
  });

  it("ゲストは、ゲストを含めない設定（初期値）なら断り、含める設定なら確認しない", async () => {
    const { round, dog } = await setup();
    const dir = directory(["U_GUEST"]);
    const input = { roundId: round.id, userId: "U_GUEST", choiceId: dog.id, now: NOW };
    expect(await submitAnswer(db(), dir, input)).toEqual({ ok: false, reason: "guest" });

    await db().update(settings).set({ includeGuests: true });
    const before = dir.calls;
    expect((await submitAnswer(db(), dir, input)).ok).toBe(true);
    expect(dir.calls).toBe(before);
    await db().update(settings).set({ includeGuests: false });
  });
});
