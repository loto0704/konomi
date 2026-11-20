/** 日本語の文言。キーは「場所.内容」。{name} は t() の vars で置き換える */
export const ja = {
  "command.notReady": "konomi は準備中です。もうしばらくお待ちください。",
} as const;

export type MessageKey = keyof typeof ja;
