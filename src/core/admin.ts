import type { Db } from "../db/client";
import { isAdminInDb } from "../db/repo";

/**
 * 管理者か。ADMIN_USER_IDS の人は常に管理者で、それ以外は admins テーブルを見る。
 * リクエストごとに確かめ、結果をどこにも持たない。
 */
export async function isAdmin(
  db: Db,
  configAdmins: readonly string[],
  userId: string,
): Promise<boolean> {
  if (configAdmins.includes(userId)) return true;
  return isAdminInDb(db, userId);
}
