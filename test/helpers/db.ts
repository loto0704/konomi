import { env } from "cloudflare:test";
import { createDb } from "../../src/db/client";
import { rounds, topicChoices, topics } from "../../src/db/schema";

export const db = () => createDb(env.DB);

/** テスト用のお題（選択肢つき）を作る */
export async function makeTopic(
  overrides: Partial<typeof topics.$inferInsert> = {},
  labels: string[] = ["犬", "猫"],
) {
  const d = db();
  const [topic] = await d
    .insert(topics)
    .values({ question: "犬派？猫派？", ...overrides })
    .returning();
  if (!topic) throw new Error("topic not inserted");
  const choices =
    labels.length === 0
      ? []
      : await d
          .insert(topicChoices)
          .values(labels.map((label, position) => ({ topicId: topic.id, label, position })))
          .returning();
  return { topic, choices };
}

/** テスト用の配信を作る */
export async function makeRound(
  topicId: string,
  overrides: Partial<typeof rounds.$inferInsert> = {},
) {
  const [round] = await db()
    .insert(rounds)
    .values({
      topicId,
      type: "channel",
      resultVisibility: "anonymous",
      channelId: "C0CHANNEL",
      messageTs: "1.000",
      createdAt: Math.floor(Date.now() / 1000),
      ...overrides,
    })
    .returning();
  if (!round) throw new Error("round not inserted");
  return round;
}
