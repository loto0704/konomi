import { ja, type MessageKey } from "./ja";

export type { MessageKey };

/** 文言を引く。{name} を vars の値で置き換える。将来ここで言語を切り替える */
export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  const template: string = ja[key];
  if (!vars) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) =>
    name in vars ? String(vars[name]) : match,
  );
}
