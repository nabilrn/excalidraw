import { getDatabase } from "../../lib/db";

export async function getSetting(key: string): Promise<string | null> {
  const database = await getDatabase();
  const rows = await database.select<Array<{ value: string }>>(
    "SELECT value FROM settings WHERE key = ? LIMIT 1",
    [key],
  );
  return rows[0]?.value ?? null;
}

export async function setSetting(key: string, value: string) {
  const database = await getDatabase();
  await database.execute(
    `INSERT INTO settings (key, value)
     VALUES (?, ?)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value`,
    [key, value],
  );
}
