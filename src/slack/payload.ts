/**
 * Slack から届く本文（application/x-www-form-urlencoded）を型付きのオブジェクトにする。
 * 形が想定と違えば null を返す。中身の解釈（コマンドの振り分けなど）はステップ3以降で行う。
 */

/** スラッシュコマンド */
export type SlashCommand = {
  teamId: string;
  userId: string;
  command: string;
  text: string;
  triggerId: string;
  channelId: string;
  responseUrl: string;
};

/** ボタンやモーダル送信など（`payload` に JSON で入ってくるもの）。使う項目だけを型にする */
export type InteractionPayload = {
  type: string;
  team: { id: string };
  user: { id: string; team_id: string };
  [key: string]: unknown;
};

export type SlackRequest =
  | { kind: "command"; command: SlashCommand }
  | { kind: "interaction"; payload: InteractionPayload };

export function parseSlackBody(body: string): SlackRequest | null {
  const params = new URLSearchParams(body);
  const payload = params.get("payload");
  if (payload !== null) {
    const parsed = parseInteraction(payload);
    return parsed ? { kind: "interaction", payload: parsed } : null;
  }
  const command = parseCommand(params);
  return command ? { kind: "command", command } : null;
}

function parseCommand(params: URLSearchParams): SlashCommand | null {
  const teamId = params.get("team_id");
  const userId = params.get("user_id");
  const command = params.get("command");
  if (!teamId || !userId || !command) return null;
  return {
    teamId,
    userId,
    command,
    text: params.get("text") ?? "",
    triggerId: params.get("trigger_id") ?? "",
    channelId: params.get("channel_id") ?? "",
    responseUrl: params.get("response_url") ?? "",
  };
}

function parseInteraction(json: string): InteractionPayload | null {
  let value: unknown;
  try {
    value = JSON.parse(json);
  } catch {
    return null;
  }
  if (!isRecord(value) || typeof value.type !== "string") return null;
  const { team, user } = value;
  if (!isRecord(team) || typeof team.id !== "string") return null;
  if (!isRecord(user) || typeof user.id !== "string" || typeof user.team_id !== "string") {
    return null;
  }
  return value as InteractionPayload;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * リクエストが SLACK_TEAM_ID のワークスペースから来たものか。
 * 操作（ボタン・モーダル）は、操作した人の所属（user.team_id）も確かめる。
 * Slack Connect の外部ユーザーはここで弾かれる。
 */
export function isFromTeam(req: SlackRequest, teamId: string): boolean {
  if (req.kind === "command") return req.command.teamId === teamId;
  return req.payload.team.id === teamId && req.payload.user.team_id === teamId;
}
