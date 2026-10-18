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
    sort_order INTEGER NOT NULL DEFAULT 0,
    icon TEXT,
    color TEXT
  );

  CREATE TABLE IF NOT EXISTS subcategories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    category_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (category_id) REFERENCES categories(id) ON DELETE CASCADE
  );

  -- Третий уровень: статья внутри подкатегории.
  -- Вынесена в отдельную таблицу (а не parent_id в subcategories), чтобы
  -- существующие запросы второго уровня продолжили работать без изменений.
  CREATE TABLE IF NOT EXISTS subitems (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    subcategory_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    is_custom INTEGER NOT NULL DEFAULT 0,
    sort_order INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id) ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS expenses (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    -- Nullable начиная с 1.0.22: удаление категории больше не удаляет траты,
    -- а оставляет их в базе без категории. Такие траты видны в таблице и
    -- отчёте под ключом «Без категории» и по-прежнему влияют на остаток.
    category_id INTEGER,
    subcategory_id INTEGER,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    subitem_id INTEGER,
    loan_id INTEGER,
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id),
    FOREIGN KEY (subitem_id) REFERENCES subitems(id)
  );

  CREATE TABLE IF NOT EXISTS balance_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL,
    date TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  -- Справочник категорий внесений. До 1.0.8 роль этой справочника играл
  -- свободный комментарий в каждом внесении; теперь одинаковые комментарии
  -- схлопываются в одну категорию (см. migrateDepositNotesToCategories).
  --
  -- Про NOCASE: его здесь сознательно нет. better-sqlite3 собран без ICU,
  -- а встроенный в SQLite NOCASE раскладывает только ASCII — «Зарплата» и
  -- «зарплата» для него разные строки, и UNIQUE не срабатывает. Проверено
  -- экспериментально: дубль всё равно вставляется. Поэтому сравнение
  -- без учёта регистра делается в JS (см. db:addDepositCategory).
  CREATE TABLE IF NOT EXISTS deposit_categories (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL UNIQUE,
    -- Цвет сектора на графике «Приход по категориям»
    color TEXT,
    sort_order INTEGER NOT NULL DEFAULT 0
  );

  -- Внесение денег. В отличие от balance_history (снимок остатка) это
  -- операция поступления. Категория обязательна — её отсутствие проверяет
  -- сам слой внесения (db:addDeposit), CHECK здесь невозможен, потому что
  -- ссылка на справочник не гарантирует непустоту и разрешает NULL.
  CREATE TABLE IF NOT EXISTS deposits (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    amount REAL NOT NULL CHECK (amount > 0),
    date TEXT NOT NULL,
    category_id INTEGER REFERENCES deposit_categories(id),
    -- Историческое. Комментарий превратился в категорию, текст переехал в
    -- deposit_categories.name, но оригинал оставлен на месте: при объединении
    -- «зарплата» и «Зарплата » именно здесь сохранилась разница формулировок.
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
  CREATE INDEX IF NOT EXISTS idx_balance_date ON balance_history(date);
  CREATE INDEX IF NOT EXISTS idx_deposits_date ON deposits(date);
  -- Индекс по category_id создаётся не здесь, а после migrateDepositNotesToCategories:
  -- на старой БД колонки category_id ещё нет, и CREATE INDEX упал бы с
  -- «no such column». На новой БД он создаётся там же, в конце applySchema.

  -- Служебные настройки. Ключ deleted_default:<имя> означает, что встроенную
  -- категорию удалили намеренно, и создавать её при следующем старте не надо.
  CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT
  );

  -- Регулярный платёж: аренда, подписка, связь, проездной и тому подобное.
  --
  -- Хранится именно next_date (дата следующего платежа), а не «день месяца».
  -- Так расписание переживает пропущенные месяцы и не требует пересчёта при
  -- каждом открытии программы: пока next_date в прошлом, платёж считается
  -- просроченным, а отметка «оплачено» двигает дату вперёд на период.
  --
  -- Сдвиг даты делается в JS (см. advanceRecurringDate в main.ts): SQLite
  -- не умеет прибавлять месяцы, а наивное прибавление через setMonth
  -- переполняет месяц — 31 января превратился бы в 3 марта.
  CREATE TABLE IF NOT EXISTS recurring (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    subcategory_id INTEGER,
    subitem_id INTEGER,
    amount REAL NOT NULL CHECK (amount > 0),
    -- daily | weekly | monthly | quarterly | yearly
    frequency TEXT NOT NULL,
    next_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES categories(id),
    FOREIGN KEY (subcategory_id) REFERENCES subcategories(id),
    FOREIGN KEY (subitem_id) REFERENCES subitems(id)
  );

  CREATE INDEX IF NOT EXISTS idx_recurring_next ON recurring(is_active, next_date);

  -- Заём: взяли деньги, чтобы оплатить закуп, вернём через пару дней.
  --
  -- Деньги проходят через обычные deposits и expenses — остаток считается
  -- сам по себе, формулу трогать не нужно. А вот для статистики такие записи
  -- не должны выглядеть доходом и расходом: кредит — это чужие деньги.
  -- Поэтому на записях ставится loan_id, а отчёты их исключают и показывают
  -- отдельным разделом. Без этого месяц с кредитом показывал бы двойной
  -- расход и ненулевой доход, которого не было.
  CREATE TABLE IF NOT EXISTS loans (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    -- Кто дал: банк, человек, касса. Свободный текст.
    source TEXT,
    amount REAL NOT NULL CHECK (amount > 0),
    -- Когда взяли
    date_taken TEXT NOT NULL,
    -- Когда вернуть. По этой дате считается просрочка.
    date_due TEXT NOT NULL,
    note TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  );

  CREATE INDEX IF NOT EXISTS idx_loans_due ON loans(date_due);

  -- Регулярное внесение: выплата агрегатора раз в неделю.
  --
  -- Отдельная таблица, а не флаг в recurring: там траты (расходы), здесь
  -- поступления. Общего только способ сдвига даты — advanceRecurringDate.
  CREATE TABLE IF NOT EXISTS recurring_income (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    category_id INTEGER NOT NULL,
    -- Сумма ДО удержания процента платформой
    amount REAL NOT NULL CHECK (amount > 0),
    -- Доля удержания: 0.25 = 25%. Хранится долей, а не процентами,
    -- чтобы умножение работало напрямую: net = amount * (1 - commission)
    commission REAL NOT NULL DEFAULT 0
      CHECK (commission >= 0 AND commission < 1),
    -- daily | weekly | monthly | quarterly | yearly
    frequency TEXT NOT NULL,
    next_date TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (category_id) REFERENCES deposit_categories(id)
  );

  CREATE INDEX IF NOT EXISTS idx_recurring_income_next
    ON recurring_income(is_active, next_date);
`;

export const DEFAULT_CATEGORIES: { name: string; type: string; sortOrder: number }[] = [
  { name: 'Закуп', type: 'expense', sortOrder: 1 },
  { name: 'Такси', type: 'expense', sortOrder: 2 },
];

export const DEFAULT_CATEGORY_ICONS: Record<string, string> = {
  Закуп: 'cart',
  Такси: 'car',
};

/**
 * Цвета для кольцевой диаграммы. Подобраны так, чтобы соседние сектора
 * различались и при большом числе категорий: контраст по светлоте, а не
 * только по тону. Розовый и голубой разведены по краям круга.
 */
export const CATEGORY_COLORS: string[] = [
  '#00d4aa', // бирюзовый
  '#ff6b6b', // коралловый
  '#ffd166', // янтарный
  '#4cc9f0', // небесный
  '#c77dff', // сиреневый
  '#06d6a0', // изумрудный
  '#ef476f', // малиновый
  '#118ab2', // лазурный
  '#f4a261', // песочный
  '#8ecae6', // небесно-голубой
  '#b56576', // сливовый
  '#52b788', // зелёный
  '#e76f51', // терракотовый
  '#4361ee', // кобальт
  '#f72585', // фуксия
  '#3a86ff', // синий
  '#8338ec', // фиолетовый
  '#ffbe0b', // золотой
];

export const DEFAULT_CATEGORY_COLORS: Record<string, string> = {
  Закуп: CATEGORY_COLORS[0],
  Такси: CATEGORY_COLORS[1],
};

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

/** Статистика переноса комментариев внесений в категории */
export interface DepositNoteMigrationResult {
  /** Сколько категорий создано */
  categoriesCreated: number;
  /** Сколько внесений получили категорию */
  depositsLinked: number;
  /** Сколько внесений было с одинаковым комментарием и слилось в одну категорию */
  depositsMerged: number;
}

/**
 * Снимает NOT NULL с expenses.category_id.
 *
 * С 1.0.22 удаление категории не удаляет траты: они остаются в базе без
 * категории и показываются под ключом «Без категории». Пока колонка NOT NULL,
 * обнулить ссылку нельзя — а именно это и нужно сделать при удалении.
 *
 * Таблицу приходится пересоздавать: SQLite не умеет снимать ограничения через
 * ALTER. Как и в migrateDepositNotesToCategories, миграция определяется по
 * самой схеме, а не по флажку в settings, поэтому повторный запуск безопасен.
 * id переносятся явно — иначе история перемешалась бы, а AUTOINCREMENT
 * продолжил бы счёт не с того места.
 */
export function migrateExpensesNullableCategory(database: Database): boolean {
  const cols = database.prepare('PRAGMA table_info(expenses)').all() as {
    name: string;
    notnull: number;
  }[];
  const categoryCol = cols.find((c) => c.name === 'category_id');
  if (!categoryCol || categoryCol.notnull !== 1) return false;

  const hasLoan = cols.some((c) => c.name === 'loan_id');

  const migrate = database.transaction(() => {
    database.exec(`
      CREATE TABLE expenses_new (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        category_id INTEGER,
        subcategory_id INTEGER,
        amount REAL NOT NULL,
        date TEXT NOT NULL,
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now')),
        subitem_id INTEGER,
        loan_id INTEGER,
        FOREIGN KEY (category_id) REFERENCES categories(id),
        FOREIGN KEY (subcategory_id) REFERENCES subcategories(id),
        FOREIGN KEY (subitem_id) REFERENCES subitems(id)
      )
    `);
    database.exec(`
      INSERT INTO expenses_new
        (id, category_id, subcategory_id, subitem_id, amount, date, note, created_at, loan_id)
      SELECT id, category_id, subcategory_id, subitem_id, amount, date, note, created_at,
             ${hasLoan ? 'loan_id' : 'NULL'}
      FROM expenses
    `);
    database.exec(`DROP TABLE expenses`);
    database.exec(`ALTER TABLE expenses_new RENAME TO expenses`);
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_expenses_date ON expenses(date);
      CREATE INDEX IF NOT EXISTS idx_loans_link_expense ON expenses(loan_id);
    `);
  });
  migrate();

  console.log('[schema] expenses.category_id больше не NOT NULL: траты переживают удаление категории');
  return true;
}

/**
 * Превращает комментарий внесения в категорию справочника.
 *
 * Одинаковые комментарии объединяются: сравнение идёт без учёта регистра и
 * лишних пробелов, в качестве названия категории берётся первая встреченная
 * формулировка. «зарплата », «Зарплата» и «ЗАРПЛАТА» станут одной категорией.
 *
 * Таблицу приходится пересоздавать: в старой схеме note — NOT NULL с
 * CHECK (length(trim(note)) > 0), из-за чего нельзя записать внесение без
 * комментария. ALTER TABLE в SQLite не умеет снимать эти ограничения.
 *
 * Повторный запуск безопасен — миграция определяется по самой схеме
 * (note NOT NULL), а не по флажку в settings.
 */
export function migrateDepositNotesToCategories(
  database: Database
): DepositNoteMigrationResult | null {
  const cols = database.prepare('PRAGMA table_info(deposits)').all() as {
    name: string;
    notnull: number;
  }[];
  const noteCol = cols.find((c) => c.name === 'note');
  const hasCategoryColumn = cols.some((c) => c.name === 'category_id');

  // Уже новая схема — переносить нечего.
  if (!noteCol || noteCol.notnull !== 1 || hasCategoryColumn) return null;

  const rows = database
    .prepare(`SELECT id, note FROM deposits WHERE note IS NOT NULL AND trim(note) <> ''`)
    .all() as { id: number; note: string }[];

  // Схлопываем комментарии по нормализованному ключу. Ключи сортируем по id,
  // чтобы при недетерминированном порядке выборки название категории не «прыгал».
  const normalized = new Map<string, { name: string; ids: number[] }>();
  for (const row of rows) {
    const name = row.note.trim().replace(/\s+/g, ' ');
    const key = name.toLowerCase();
    const existing = normalized.get(key);
    if (existing) existing.ids.push(row.id);
    else normalized.set(key, { name, ids: [row.id] });
  }

  const result: DepositNoteMigrationResult = {
    categoriesCreated: normalized.size,
    depositsLinked: rows.length,
    depositsMerged: rows.length - normalized.size,
  };

  const migrate = database.transaction(() => {
    const insertCategory = database.prepare(
      `INSERT INTO deposit_categories (name, sort_order) VALUES (?, ?)`
    );
    let order = 0;
    // normalized уже содержит по одной записи на уникальный ключ,
    // поэтому обычный INSERT — без IGNORE и без гонок.
    for (const entry of normalized.values()) insertCategory.run(entry.name, ++order);

    // category_id в старой таблице нет — сначала добавляем колонку,
    // затем переливаем данные и переименовываем.
    database.exec(`ALTER TABLE deposits ADD COLUMN category_id INTEGER`);
    database.exec(`
      CREATE TABLE deposits_v2 (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        amount REAL NOT NULL CHECK (amount > 0),
        date TEXT NOT NULL,
        category_id INTEGER REFERENCES deposit_categories(id),
        note TEXT,
        created_at TEXT NOT NULL DEFAULT (datetime('now'))
      );
    `);
    // note переносим как есть — это историческая копия формулировки,
    // а category_id ставим точным UPDATE по id, чтобы не зависеть от
    // совпадения выражений нормализации между JS и SQL.
    database.exec(`
      INSERT INTO deposits_v2 (id, amount, date, category_id, note, created_at)
      SELECT id, amount, date, NULL, note, created_at FROM deposits
    `);

    const findCategory = database.prepare(
      `SELECT id, name FROM deposit_categories`
    );
    const setCategory = database.prepare(`UPDATE deposits_v2 SET category_id = ? WHERE id = ?`);
    const byId = new Map(
      (findCategory.all() as { id: number; name: string }[]).map((c) => [c.id, c])
    );
    // Ищем по нормализованному ключу в JS: SQLite без ICU не умеет
    // сравнивать кириллицу без учёта регистра (см. комментарий в SCHEMA_SQL).
    const byName = new Map<string, number>();
    for (const c of byId.values()) byName.set(c.name.trim().toLowerCase(), c.id);

    for (const entry of normalized.values()) {
      const catId = byName.get(entry.name.toLowerCase());
      if (!catId) continue;
      for (const id of entry.ids) setCategory.run(catId, id);
    }

    database.exec(`DROP TABLE deposits`);
    database.exec(`ALTER TABLE deposits_v2 RENAME TO deposits`);
    // Индексы создавались на старой таблице и исчезли вместе с ней.
    database.exec(`
      CREATE INDEX IF NOT EXISTS idx_deposits_date ON deposits(date);
      CREATE INDEX IF NOT EXISTS idx_deposits_category ON deposits(category_id);
    `);
  });
  migrate();

  console.log(
    `[schema] Комментарии внесений → категории: ${result.categoriesCreated} категорий, ` +
      `${result.depositsLinked} внесений, из них ${result.depositsMerged} объединено с дублями`
  );
  return result;
}

/**
 * Создаёт схему и наполняет БД дефолтными категориями.
 * Идемпотентна: безопасно вызывать на уже существующей БД.
 */
export function applySchema(database: Database): void {
  database.exec(SCHEMA_SQL);

  // Пересоздаёт expenses, поэтому идёт сразу: всё, что дальше работает с этой
  // таблицей, уже видит nullable category_id.
  migrateExpensesNullableCategory(database);

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

  // Миграция: колонка значка добавлена в версии 1.0.6. В SQLite нельзя
  // ALTER TABLE ... ADD COLUMN IF NOT EXISTS, поэтому проверяем заранее.
  // Для БД из установщика колонка уже есть в SCHEMA_SQL.
  const columns = database.prepare('PRAGMA table_info(categories)').all() as {
    name: string;
  }[];
  if (!columns.some((c) => c.name === 'icon')) {
    database.exec(`ALTER TABLE categories ADD COLUMN icon TEXT`);
    console.log('[schema] Добавлена колонка categories.icon');
  }

  // Миграция 1.0.7: свой цвет категории (для графиков) и третий уровень.
  if (!columns.some((c) => c.name === 'color')) {
    database.exec(`ALTER TABLE categories ADD COLUMN color TEXT`);
    console.log('[schema] Добавлена колонка categories.color');
  }
  const expenseCols = database.prepare('PRAGMA table_info(expenses)').all() as {
    name: string;
  }[];
  if (!expenseCols.some((c) => c.name === 'subitem_id')) {
    database.exec(`ALTER TABLE expenses ADD COLUMN subitem_id INTEGER`);
    console.log('[schema] Добавлена колонка expenses.subitem_id');
  }

  // Третий уровень уникален внутри подкатегории — иначе повторный запуск
  // продублирует статьи так же, как когда-то дублировались подкатегории.
  database.exec(`
    CREATE UNIQUE INDEX IF NOT EXISTS idx_subitems_unique
      ON subitems(subcategory_id, name);
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_subitems_parent
      ON subitems(subcategory_id);
  `);

  // Встроенным категориям назначаем значки и цвета по умолчанию
  const assignIcon = database.prepare(
    `UPDATE categories SET icon = ? WHERE name = ? AND (icon IS NULL OR icon = '')`
  );
  for (const [name, icon] of Object.entries(DEFAULT_CATEGORY_ICONS)) {
    assignIcon.run(icon, name);
  }

  const assignColor = database.prepare(
    `UPDATE categories SET color = ? WHERE name = ? AND (color IS NULL OR color = '')`
  );
  for (const [name, color] of Object.entries(DEFAULT_CATEGORY_COLORS)) {
    assignColor.run(color, name);
  }

  const insertCategory = database.prepare(
    `INSERT OR IGNORE INTO categories (name, type, is_custom, sort_order) VALUES (?, ?, 0, ?)`
  );
  const insertSubcategory = database.prepare(
    `INSERT OR IGNORE INTO subcategories (category_id, name, is_custom, sort_order) VALUES (?, ?, 0, ?)`
  );

  // Категории, которые пользователь удалил осознанно, больше не создаём.
  // Сюда же попадают переименованные встроенные категории: если «Закуп» назвали
  // «Покупки», то старый ключ deleted_default:Закуп убережёт от возврата.
  const dismissed = new Set(
    (
      database
        .prepare(
          `SELECT key FROM settings
           WHERE key LIKE 'deleted_default:%' OR key LIKE 'renamed_default:%'`
        )
        .all() as { key: string }[]
    ).map((r) => r.key.replace(/^(?:deleted|renamed)_default:/, ''))
  );

  // Подкатегории, переименованные у встроенных категорий. Ключ хранит id
  // родителя, а не его имя: иначе переименование самой категории делало бы
  // запись бессмысленной и подкатегория вернулась бы при следующем запуске.
  const renamedSubs = new Set(
    (
      database
        .prepare(`SELECT key FROM settings WHERE key LIKE 'renamed_sub:%'`)
        .all() as { key: string }[]
    ).map((r) => r.key.slice('renamed_sub:'.length))
  );

  for (const cat of DEFAULT_CATEGORIES) {
    if (dismissed.has(cat.name)) continue;
    insertCategory.run(cat.name, cat.type, cat.sortOrder);
  }

  const categoryRows = database
    .prepare('SELECT id, name FROM categories WHERE is_custom = 0')
    .all() as { id: number; name: string }[];
  const categoryMap = Object.fromEntries(categoryRows.map((c) => [c.name, c.id]));

  // Подкатегории, удалённые пользователем, тоже не создаём заново.
  const dismissedSubs = new Set(
    (
      database
        .prepare(`SELECT key FROM settings WHERE key LIKE 'deleted_sub:%'`)
        .all() as { key: string }[]
    ).map((r) => r.key.replace('deleted_sub:', ''))
  );

  if (categoryMap['Закуп']) {
    ZAKUP_SUBCATEGORIES.forEach((sub, idx) => {
      if (dismissedSubs.has(`Закуп:${sub}`)) return;
      if (renamedSubs.has(`${categoryMap['Закуп']}:${sub}`)) return;
      insertSubcategory.run(categoryMap['Закуп'], sub, idx + 1);
    });
  }

  // Комментарии внесений становятся справочником категорий.
  migrateDepositNotesToCategories(database);

  // Миграция 1.0.9: свой цвет у категории внесения (для графика прихода).
  const depositCols = database.prepare('PRAGMA table_info(deposit_categories)').all() as {
    name: string;
  }[];
  if (!depositCols.some((c) => c.name === 'color')) {
    database.exec(`ALTER TABLE deposit_categories ADD COLUMN color TEXT`);
    console.log('[schema] Добавлена колонка deposit_categories.color');
  }

  // Раздаём цвета: сначала из палитры по порядку, чтобы соседние категории
  // на графике не совпали по оттенку. Существующие выборы не трогаем.
  const uncategorizedDeposits = database
    .prepare(
      `SELECT id FROM deposit_categories WHERE color IS NULL OR color = '' ORDER BY sort_order, id`
    )
    .all() as { id: number }[];
  const setDepositColor = database.prepare(`UPDATE deposit_categories SET color = ? WHERE id = ?`);
  uncategorizedDeposits.forEach((row, i) => {
    setDepositColor.run(CATEGORY_COLORS[i % CATEGORY_COLORS.length], row.id);
  });

  // Создаётся после миграции: на старой БД колонки category_id до неё нет.
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_deposits_category ON deposits(category_id);
  `);

  // Миграция 1.0.22: пометка записей, относящихся к займу.
  //
  // Колонка nullable: обычные траты и внесения ничего не знают о займах и
  // остаются как были. Отчёты отбирают «loan_id IS NULL», поэтому старые
  // записи продолжают попадать в обычную статистику без всякой правки.
  const depositColsFull = database.prepare('PRAGMA table_info(deposits)').all() as {
    name: string;
  }[];
  if (!depositColsFull.some((c) => c.name === 'loan_id')) {
    database.exec(`ALTER TABLE deposits ADD COLUMN loan_id INTEGER`);
    console.log('[schema] Добавлена колонка deposits.loan_id');
  }
  if (!expenseCols.some((c) => c.name === 'loan_id')) {
    database.exec(`ALTER TABLE expenses ADD COLUMN loan_id INTEGER`);
    console.log('[schema] Добавлена колонка expenses.loan_id');
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_loans_link_deposit ON deposits(loan_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_loans_link_expense ON expenses(loan_id)`);
}