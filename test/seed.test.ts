import { describe, expect, it } from "vitest";
import seed from "../seed/topics.ja.json";
import { listActiveChoiceTopics } from "../src/db/repo";
import { db } from "./helpers/db";

describe("同梱のお題（マイグレーション 0002）", () => {
  it("seed/topics.ja.json のお題がすべて、同じ ID と選択肢で入っている", async () => {
    const d = db();
    const rows = await d.query.topics.findMany();
    const choices = await d.query.topicChoices.findMany();
    for (const s of seed) {
      const topic = rows.find((r) => r.id === s.id);
      expect(topic, s.question).toMatchObject({
        question: s.question,
        recommendedType: s.recommendedType,
        resultVisibility: s.resultVisibility,
        answerFormat: "choice",
        isActive: true,
      });
      const labels = choices
        .filter((c) => c.topicId === s.id)
        .sort((a, b) => a.position - b.position)
        .map((c) => c.label);
      expect(labels).toEqual(s.choices);
    }
  });

  it("40個あり、どれも選択肢は2〜4個", () => {
    expect(seed).toHaveLength(40);
    for (const s of seed) {
      expect(s.choices.length).toBeGreaterThanOrEqual(2);
      expect(s.choices.length).toBeLessThanOrEqual(4);
    }
  });

  it("手動配信のお題一覧に出る", async () => {
    const list = await listActiveChoiceTopics(db(), 100);
    expect(list.length).toBeGreaterThanOrEqual(40);
  });
});
