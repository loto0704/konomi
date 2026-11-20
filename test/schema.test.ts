import { env } from "cloudflare:test";
import { eq, sql } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createDb } from "../src/db/client";
import { answers, rounds, settings, topicChoices, topics } from "../src/db/schema";

const now = () => Math.floor(Date.now() / 1000);

/** お題・選択肢・配信を1つずつ作る */
async function seedRound() {
  const db = createDb(env.DB);
  const [topic] = await db.insert(topics).values({ question: "犬派？猫派？" }).returning();
  if (!topic) throw new Error("topic not inserted");
  const choices = await db
    .insert(topicChoices)
    .values([
      { topicId: topic.id, label: "犬", position: 0 },
      { topicId: topic.id, label: "猫", position: 1 },
    ])
    .returning();
  const [round] = await db
    .insert(rounds)
    .values({
      topicId: topic.id,
      type: "channel",
      resultVisibility: topic.resultVisibility,
      channelId: "C0000000000",
      createdAt: now(),
    })
    .returning();
  if (!round) throw new Error("round not inserted");
  return { db, topic, choices, round };
}

describe("最初のマイグレーション", () => {
  it("settings に初期値の1行が入っている", async () => {
    const db = createDb(env.DB);
    const rows = await db.select().from(settings);
    expect(rows).toEqual([
      {
        id: 1,
        channelId: null,
        timezone: "Asia/Tokyo",
        excludeRecentDays: 7,
        includeGuests: false,
        maxOpenUnlimited: 10,
        retentionDays: 365,
      },
    ]);
  });

  it("settings は id = 1 以外の行を拒否する", async () => {
    const db = createDb(env.DB);
    await expect(db.insert(settings).values({ id: 2 })).rejects.toThrow();
  });

  it("お題の ID は UUID で、初期値は匿名・選択肢型・有効", async () => {
    const { topic } = await seedRound();
    expect(topic.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(topic).toMatchObject({
      recommendedType: "any",
      answerFormat: "choice",
      resultVisibility: "anonymous",
      isActive: true,
      lastUsedAt: null,
    });
  });

  it("回答は (round_id, user_id) で1件。再回答は ON CONFLICT で上書きできる", async () => {
    const { db, choices, round } = await seedRound();
    const [dog, cat] = choices;
    if (!dog || !cat) throw new Error("choices not inserted");

    await db.insert(answers).values({
      roundId: round.id,
      userId: "U1",
      choiceId: dog.id,
      answeredAt: 100,
      updatedAt: 100,
    });

    // 同じ人の2件目はユニーク制約で失敗する
    await expect(
      db.insert(answers).values({
        roundId: round.id,
        userId: "U1",
        choiceId: cat.id,
        answeredAt: 200,
        updatedAt: 200,
      }),
    ).rejects.toThrow();

    // ON CONFLICT で選択肢を上書きする
    await db
      .insert(answers)
      .values({
        roundId: round.id,
        userId: "U1",
        choiceId: cat.id,
        answeredAt: 200,
        updatedAt: 200,
      })
      .onConflictDoUpdate({
        target: [answers.roundId, answers.userId],
        set: { choiceId: cat.id, updatedAt: 200 },
      });

    const rows = await db.select().from(answers).where(eq(answers.roundId, round.id));
    expect(rows).toEqual([
      { roundId: round.id, userId: "U1", choiceId: cat.id, answeredAt: 100, updatedAt: 200 },
    ]);
  });

  it("外部キーが有効で、配信を消すと回答も消える（保存期間の削除に使う）", async () => {
    const { db, choices, round } = await seedRound();
    const [dog] = choices;
    if (!dog) throw new Error("choices not inserted");

    // 存在しない配信への回答は拒否される
    await expect(
      db
        .insert(answers)
        .values({ roundId: 999_999, userId: "U1", choiceId: dog.id, answeredAt: 1, updatedAt: 1 }),
    ).rejects.toThrow();

    await db
      .insert(answers)
      .values({ roundId: round.id, userId: "U2", choiceId: dog.id, answeredAt: 1, updatedAt: 1 });
    await db.delete(rounds).where(eq(rounds.id, round.id));

    const [{ count } = { count: -1 }] = await db
      .select({ count: sql<number>`count(*)` })
      .from(answers)
      .where(eq(answers.roundId, round.id));
    expect(count).toBe(0);
  });
});
