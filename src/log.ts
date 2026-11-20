/**
 * ログはすべてここを通して出す。
 *
 * 出してよいのは、種類・件数・所要時間・エラーコード・配信IDなど。
 * トークン、署名、Cookie、回答内容、user_id、team_id、メッセージ本文は渡さないこと。
 */

type Fields = Record<string, string | number | boolean | undefined>;
type Level = "info" | "warn" | "error";

function write(level: Level, event: string, fields?: Fields) {
  const line = JSON.stringify({ level, event, ...fields });
  if (level === "error") console.error(line);
  else if (level === "warn") console.warn(line);
  else console.log(line);
}

export const log = {
  info: (event: string, fields?: Fields) => write("info", event, fields),
  warn: (event: string, fields?: Fields) => write("warn", event, fields),
  error: (event: string, fields?: Fields) => write("error", event, fields),
};
