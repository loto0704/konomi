// 同梱のお題（seed/topics.ja.json）から、マイグレーションの SQL を作る。
//
// 使い方：node scripts/seed-topics-sql.mjs > migrations/<番号>_seed_topics.sql
//
// - お題は固定の UUID で入れ、すでにあれば何もしない（ON CONFLICT DO NOTHING）
// - 選択肢は、そのお題の同じ位置に選択肢がないときだけ入れる
// どの環境に何度当てても同じ結果になるようにしている。
import { readFileSync } from "node:fs";

const RECOMMENDED = new Set(["channel", "dm", "any"]);
const VISIBILITY = new Set(["anonymous", "named"]);
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

const path = process.argv[2] ?? new URL("../seed/topics.ja.json", import.meta.url);
const topics = JSON.parse(readFileSync(path, "utf8"));

const q = (s) => `'${String(s).replaceAll("'", "''")}'`;
const ids = new Set();
const lines = [
  "-- 同梱のお題。scripts/seed-topics-sql.mjs で seed/topics.ja.json から作った。手で編集しない",
];

for (const t of topics) {
  if (!UUID.test(t.id) || ids.has(t.id)) throw new Error(`bad or duplicate id: ${t.id}`);
  ids.add(t.id);
  if (typeof t.question !== "string" || t.question.trim() === "")
    throw new Error(`empty question: ${t.id}`);
  if (!Array.isArray(t.choices) || t.choices.length < 2 || t.choices.length > 4) {
    throw new Error(`choices must be 2-4: ${t.id}`);
  }
  if (!RECOMMENDED.has(t.recommendedType)) throw new Error(`bad recommendedType: ${t.id}`);
  if (!VISIBILITY.has(t.resultVisibility)) throw new Error(`bad resultVisibility: ${t.id}`);

  lines.push(
    `INSERT INTO \`topics\` (\`id\`, \`question\`, \`recommended_type\`, \`answer_format\`, \`result_visibility\`) VALUES (${q(t.id)}, ${q(t.question)}, ${q(t.recommendedType)}, 'choice', ${q(t.resultVisibility)}) ON CONFLICT (\`id\`) DO NOTHING;`,
  );
  t.choices.forEach((label, position) => {
    lines.push(
      `INSERT INTO \`topic_choices\` (\`topic_id\`, \`label\`, \`position\`) SELECT ${q(t.id)}, ${q(label)}, ${position} WHERE NOT EXISTS (SELECT 1 FROM \`topic_choices\` WHERE \`topic_id\` = ${q(t.id)} AND \`position\` = ${position});`,
    );
  });
}

process.stdout.write(`${lines.join("\n")}\n`);
