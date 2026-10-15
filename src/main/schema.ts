import type { Database } from 'better-sqlite3';

/**
 * Единый источник схемы БД.
 * Используется и при первом запуске (создание БД),
 * и при сборке установщика (генерация шаблонной БД),
 * чтобы структура и дефолтные категории всегда совпадали.
 */

export const SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    type TEXT NOT NULL DEFAULT 'expense',
    is_custom INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS subcategories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    subcategory_id INTEGER,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id)
  );

  CREATE TABLE IF NOT EXISTS balance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Внесение денег. В отличие от balance_history (снимок остатка) это
  -- операция поступления. Комментарий обязателен: CHECK не даёт записать
  -- пустой, даже если проверку на клиенте обойти.
  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL CHECK (amount > 0),
    date TEXT NOT NULL,
    note TEXT NOT NULL CHECK (length(trim(note)) > 0),
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_balance_date ON balance_history(date);
  CREATE INDEX IF NOT EXISTS idx_deposits_date ON deposits(date);
`;

export const DEFAULT_CATEGORIES: { name: string; type: string; sortOrder: number }[] = [
  { name: 'Закуп', type: 'expense', sortOrder: 1 },
  { name: 'Такси', type: 'expense', sortOrder: 2 },
];

export const ZAKUP_SUBCATEGORIES = [
  'Российский',
  'Рыба',
  'Боксы',
  'Курица',
  'Овощи',
  'Хоз.товары',
  'Кола',
  'Вода',
  'Камшат',
];

/**
 * Создаёт схему и наполняет БД дефолтными категориями.
 * Идемпотентна: безопасно вызывать на уже существующей БД.
 */
export function applySchema(database: Database): void {
  database.exec(SCHEMA_SQL);

  // Миграция: уникальность подкатегорий внутри категории.
  // Без этого повторные запуски дублируют дефолтные подкатегории,
  // т.к. в таблице нет UNIQUE-ограничения и INSERT OR IGNORE не срабатывает.
  // Сначала чистим дубли, только потом создаём индекс (иначе он не создастся).
  const duplicates = database
    .prepare(
      `SELECT category_id, name, MIN(id) AS keep_id
       FROM subcategories
       GROUP BY category_id, name
       HAVING COUNT(*) > 1`
    )
    .all() as { category_id: number; name: string; keep_id: number }[];

  if (duplicates.length > 0) {
    const findByName = database.prepare(
      `SELECT id FROM subcategories WHERE category_id = ? AND name = ? ORDER BY id`
    );
    const repointExpenses = database.prepare(
      `UPDATE expenses SET subcategory_id = ? WHERE subcategory_id = ?`
    );
    const deleteSub = database.prepare(`DELETE FROM subcategories WHERE id = ?`);

    const cleanup = database.transaction(() => {
      for (const dup of duplicates) {
        const rows = findByName.all(dup.category_id, dup.name) as { id: number }[];
        for (const row of rows) {
          if (row.id === dup.keep_id) continue;
          repointExpenses.run(dup.keep_id, row.id);
          deleteSub.run(row.id);
        }
      }
    });
    cleanup();
  }

  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subcategories_unique
      ON subcategories(category_id, name);
  `);

  const insertCategory = database.prepare(
    `INSERT OR IGNORE INTO categories (name, type, is_custom, sort_order) VALUES (?, ?, 0, ?)`
  );
  const insertSubcategory = database.prepare(
    `INSERT OR IGNORE INTO subcategories (category_id, name, is_custom, sort_order) VALUES (?, ?, 0, ?)`
  );

  for (const cat of DEFAULT_CATEGORIES) {
    insertCategory.run(cat.name, cat.type, cat.sortOrder);
  }

  const categoryRows = database
    .prepare('SELECT id, name FROM categories WHERE is_custom = 0')
    .all() as { id: number; name: string }[];
  const categoryMap = Object.fromEntries(categoryRows.map((c) => [c.name, c.id]));

  if (categoryMap['Закуп']) {
    ZAKUP_SUBCATEGORIES.forEach((sub, idx) => {
      insertSubcategory.run(categoryMap['Закуп'], sub, idx + 1);
    });
  }
}