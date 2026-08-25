import Database from "@tauri-apps/plugin-sql";

const DATABASE_URL = "sqlite:focuscanvas.db";

let databasePromise: Promise<Database> | null = null;

export function getDatabase() {
  if (!databasePromise) {
    databasePromise = Database.load(DATABASE_URL).then(async (database) => {
      await database.execute("PRAGMA foreign_keys = ON");
      return database;
    });
  }

  return databasePromise;
}
