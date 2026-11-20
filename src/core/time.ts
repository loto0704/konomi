/**
 * タイムゾーンを考えた日時の計算。ライブラリを使わず Intl だけで行う。
 * 日時はすべて UNIX 秒。
 */

type Parts = { year: number; month: number; day: number; hour: number; minute: number };

function partsIn(unix: number, timeZone: string): Parts {
  const fmt = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
  });
  const get = (type: string) =>
    Number(fmt.formatToParts(new Date(unix * 1000)).find((p) => p.type === type)?.value);
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour"),
    minute: get("minute"),
  };
}

/** timeZone での現地時刻 → UNIX 秒 */
export function zonedToUnix(p: Parts, timeZone: string): number {
  const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute) / 1000;
  // 現地時刻を UTC とみなした値から、その時点のずれを引く（夏時間の境目も2回で収まる）
  let guess = asUtc;
  for (let i = 0; i < 2; i++) {
    const q = partsIn(guess, timeZone);
    const shown = Date.UTC(q.year, q.month - 1, q.day, q.hour, q.minute) / 1000;
    guess += asUtc - shown;
  }
  return guess;
}

/**
 * 次に来る timeZone の hh:mm。今日のその時刻が過ぎていれば（minLeadSeconds 以内も含む）翌日
 */
export function nextLocalTime(
  now: number,
  timeZone: string,
  hhmm: string,
  minLeadSeconds = 0,
): number {
  const [h, m] = hhmm.split(":").map(Number);
  const today = partsIn(now, timeZone);
  const at = zonedToUnix({ ...today, hour: h ?? 0, minute: m ?? 0 }, timeZone);
  if (at > now + minLeadSeconds) return at;
  const next = new Date(Date.UTC(today.year, today.month - 1, today.day + 1));
  return zonedToUnix(
    {
      year: next.getUTCFullYear(),
      month: next.getUTCMonth() + 1,
      day: next.getUTCDate(),
      hour: h ?? 0,
      minute: m ?? 0,
    },
    timeZone,
  );
}

/** 「11/20 18:00」の形。Slack の日時表示が使えないときの代わりに使う */
export function formatShort(unix: number, timeZone: string): string {
  const p = partsIn(unix, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.month}/${p.day} ${pad(p.hour)}:${pad(p.minute)}`;
}
