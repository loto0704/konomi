import { drizzle } from "drizzle-orm/d1";
import * as schema from "./schema";

/** D1 バインディングから Drizzle のクライアントを作る。データアクセスはすべて src/db を通す */
export function createDb(d1: D1Database) {
  return drizzle(d1, { schema });
}

export type Db = ReturnType<typeof createDb>;
