import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import {
  announceResult,
  closeDueRounds,
  closeRound,
  DUE_ROUNDS_PER_RUN,
  listClosableRounds,
  tally,
} from "../../src/core/closing";
import { answers, rounds } from "../../src/db/schema";
import { db, makeRound, makeTopic } from "../helpers/db";
import { FakeMessenger } from "../helpers/messenger";

const NOW = 1_800_000_000;

async function answer(roundId: number, userId: string, choiceId: number) {
  await db().insert(answers).values({ roundId, userId, choiceId, answeredAt: NOW, updatedAt: NOW });
}

describe("集計", () => {
  const choices = [
    { id: 1, topicId: "t", label: "犬", position: 0 },
    { id: 2, topicId: "t", label: "猫", position: 1 },
    { id: 3, topicId: "t", label: "鳥", position: 2 },
  ];

  it("選択肢の順に、0票も含めて票数と割合（四捨五入）を出す", () => {
    const r = tally(choices, [
      { choiceId: 2, n: 7 },
      { choiceId: 1, n: 5 },
    ]);
    expect(r.total).toBe(12);
    expect(r.items).toEqual([
      { label: "犬", count: 5, percent: 42 },
      { label: "猫", count: 7, percent: 58 },
      { label: "鳥", count: 0, percent: 0 },
    ]);
  });

  it("回答がなければ合計0、割合はすべて0", () => {
    const r = tally(choices, []);
    expect(r.total).toBe(0);
    expect(r.items.every((i) => i.percent === 0)).toBe(true);
  });
});

describe("配信の終了", () => {
  it("受付中なら終了にし、2回目は already_closed", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    expect((await closeRound(db(), round.id)).result).toBe("closed");
    expect((await closeRound(db(), round.id)).result).toBe("already_closed");
    expect((await closeRound(db(), 999_999)).result).toBe("not_found");
    const [after] = await db().select().from(rounds).where(eq(rounds.id, round.id));
    expect(after?.status).toBe("closed");
  });

  it("結果を元の投稿のスレッドに投稿する", async () => {
    const { topic, choices } = await makeTopic();
    const round = await makeRound(topic.id, { channelId: "C0POST", messageTs: "111.222" });
    const [dog, cat] = choices;
    if (!dog || !cat) throw new Error("no choices");
    await answer(round.id, "U1", cat.id);
    await answer(round.id, "U2", cat.id);
    await answer(round.id, "U3", dog.id);

    const m = new FakeMessenger();
    expect((await announceResult(db(), m, round.id, "manual")).result).toBe("posted");
    expect(m.results).toEqual([
      {
        roundId: round.id,
        channelId: "C0POST",
        threadTs: "111.222",
        reason: "manual",
        total: 3,
        items: [
          { label: "犬", count: 1, percent: 33 },
          { label: "猫", count: 2, percent: 67 },
        ],
      },
    ]);
  });

  it("投稿されていない配信にはスレッドがないため投稿しない", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id, { messageTs: null });
    const m = new FakeMessenger();
    expect((await announceResult(db(), m, round.id, "deadline")).result).toBe("not_posted");
    expect(m.results).toEqual([]);
  });

  it("投稿に失敗したら failed を返す（配信は終了のまま）", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id);
    await closeRound(db(), round.id);
    const m = new FakeMessenger();
    m.fail = true;
    const r = await announceResult(db(), m, round.id, "deadline");
    expect(r.result).toBe("failed");
  });
});

describe("締切を過ぎた配信の終了（Cron）", () => {
  it("締切を過ぎた受付中の配信だけを終了し、結果を投稿する。無期限・締切前・終了済みは触らない", async () => {
    const { topic } = await makeTopic();
    const due = await makeRound(topic.id, { deadlineAt: NOW - 60 });
    const exact = await makeRound(topic.id, { deadlineAt: NOW });
    const future = await makeRound(topic.id, { deadlineAt: NOW + 60 });
    const unlimited = await makeRound(topic.id, { deadlineAt: null });
    const done = await makeRound(topic.id, { deadlineAt: NOW - 60, status: "closed" });

    const m = new FakeMessenger();
    const report = await closeDueRounds(db(), m, NOW);
    expect(report).toEqual({ closed: 2, posted: 2, failed: [] });
    expect(m.results.map((r) => r.roundId).sort()).toEqual([due.id, exact.id].sort());
    expect(m.results.every((r) => r.reason === "deadline")).toBe(true);

    const status = async (id: number) =>
      (await db().select().from(rounds).where(eq(rounds.id, id)))[0]?.status;
    expect(await status(future.id)).toBe("open");
    expect(await status(unlimited.id)).toBe("open");
    expect(await status(done.id)).toBe("closed");

    // もう一度動いても二重に投稿しない
    const again = await closeDueRounds(db(), m, NOW);
    expect(again.closed).toBe(0);
    expect(m.results).toHaveLength(2);
  });

  it(`1回に ${DUE_ROUNDS_PER_RUN} 件まで終了し、残りは次の回に回す`, async () => {
    const { topic } = await makeTopic();
    for (let i = 0; i < DUE_ROUNDS_PER_RUN + 2; i++) {
      await makeRound(topic.id, { deadlineAt: NOW - 100 + i });
    }
    const m = new FakeMessenger();
    expect((await closeDueRounds(db(), m, NOW)).closed).toBe(DUE_ROUNDS_PER_RUN);
    expect((await closeDueRounds(db(), m, NOW)).closed).toBe(2);
  });

  it("投稿に失敗した配信も終了にし、失敗として報告する", async () => {
    const { topic } = await makeTopic();
    const round = await makeRound(topic.id, { deadlineAt: NOW - 1 });
    const m = new FakeMessenger();
    m.fail = true;
    const report = await closeDueRounds(db(), m, NOW);
    expect(report.closed).toBe(1);
    expect(report.failed.map((f) => f.roundId)).toEqual([round.id]);
  });
});

describe("手動終了で選べる配信", () => {
  it("投稿済みで受付中の配信を、新しい順に質問文つきで返す", async () => {
    const { topic } = await makeTopic({ question: "朝はパン派？ごはん派？" });
    const later = Math.floor(Date.now() / 1000) + 1000;
    const older = await makeRound(topic.id, { createdAt: later });
    const newer = await makeRound(topic.id, { createdAt: later + 100 });
    await makeRound(topic.id, { status: "closed" });
    await makeRound(topic.id, { messageTs: null });

    // ほかのテストの配信も残っているため、このお題のものだけを見る
    const list = (await listClosableRounds(db())).filter((r) => r.round.topicId === topic.id);
    expect(list.map((r) => r.round.id)).toEqual([newer.id, older.id]);
    expect(list[0]?.question).toBe("朝はパン派？ごはん派？");
  });
});
