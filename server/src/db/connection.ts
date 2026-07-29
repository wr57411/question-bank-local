import Database from 'better-sqlite3';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dbPath = process.env.DB_PATH || path.join(__dirname, '..', '..', 'data.db');

const db = new Database(dbPath);

db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function ensureColumn(table: string, column: string, definition: string): void {
  if (!/^[a-z][a-z0-9_]*$/.test(table)) throw new Error(`表名不合法: ${table}`);
  if (!/^[a-z][a-z0-9_]*$/.test(column)) throw new Error(`列名不合法: ${column}`);

  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => (row as { name: string }).name);
  if (!columns.includes(column)) {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export default db;
