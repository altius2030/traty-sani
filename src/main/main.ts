import { app, BrowserWindow, ipcMain, dialog, shell } from 'electron';
import { join } from 'path';
import {
  existsSync,
  mkdirSync,
  copyFileSync,
  readdirSync,
  unlinkSync,
  statSync,
} from 'fs';
import Database from 'better-sqlite3';
import { applySchema } from './schema';
import {
  checkForUpdates,
  downloadUpdate,
  getUpdateStatus,
  installUpdate,
  onUpdateStatus,
  RELEASE_URL,
  supportsAutoUpdate,
} from './updater';

/** Данные для экспорта отчёта в Excel — собираются в интерфейсе */
interface ReportXlsxPayload {
  title: string;
  period: string;
  startBalance: number;
  totalDeposits: number;
  totalExpenses: number;
  endBalance: number;
  checkpoint?: { amount: number; date: string | null } | null;
  expenseRows: { date: string; category: string; subcategory: string; item: string; amount: number; note: string }[];
  depositRows: { date: string; category: string; amount: number }[];
  expenseByCategory: { name: string; total: number; color: string | null }[];
  depositByCategory: { name: string; total: number; color: string | null }[];
  byDay: { label: string; expense: number; deposit: number }[];
}

const isDev = process.env.NODE_ENV === 'development';

/** Сколько автоматических копий хранить */
const BACKUP_KEEP = 10;

let mainWindow: BrowserWindow | null = null;
let db: Database.Database | null = null;

function getBackupsDir(): string {
  const dir = join(app.getPath('userData'), 'backups');
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

function timestamp(): string {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, '0');
  return (
    `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}` +
    `-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  );
}

/**
 * Копия базы в ~/backups. Вызывается вручную из интерфейса и автоматически
 * перед применением схемы — чтобы откатить неудачную миграцию.
 */
function makeBackup(dbPath: string, prefix: string): string | null {
  if (!existsSync(dbPath)) return null;
  try {
    const dest = join(getBackupsDir(), `expenses-${prefix}-${timestamp()}.db`);
    copyFileSync(dbPath, dest);

    // Ротация: оставляем последние BACKUP_KEEP копий
    const files = readdirSync(getBackupsDir())
      .filter((f) => f.startsWith('expenses-') && f.endsWith('.db'))
      .sort();
    while (files.length > BACKUP_KEEP) {
      const old = files.shift();
      if (old) {
        try {
          unlinkSync(join(getBackupsDir(), old));
        } catch {
          /* файл занят — пропускаем */
        }
      }
    }
    return dest;
  } catch (err) {
    console.error('[backup] Не удалось создать копию:', err);
    return null;
  }
}

/** РЁР°Р±Р»РѕРЅРЅР°СЏ Р‘Р”, РІС€РёС‚Р°СЏ РІ СѓСЃС‚Р°РЅРѕРІС‰РёРє (resources/template/expenses.db) */
function getBundledTemplatePath(): string | null {
  const candidates = [
    // Р’ СЃРѕР±СЂР°РЅРЅРѕРј РїСЂРёР»РѕР¶РµРЅРёРё resources Р»РµР¶Р°С‚ СЂСЏРґРѕРј СЃ asar
    join(process.resourcesPath || '', 'template', 'expenses.db'),
    // РќР° СЃР»СѓС‡Р°Р№ Р·Р°РїСѓСЃРєР° РёР· РёСЃС…РѕРґРЅРёРєРѕРІ
    join(app.getAppPath(), 'resources', 'template', 'expenses.db'),
    join(__dirname, '..', '..', 'resources', 'template', 'expenses.db'),
  ];
  for (const p of candidates) {
    if (p && existsSync(p)) return p;
  }
  return null;
}

function getDbPath(): string {
  const userDataPath = app.getPath('userData');
  const dbDir = join(userDataPath, 'database');
  if (!existsSync(dbDir)) {
    mkdirSync(dbDir, { recursive: true });
  }
  const dbPath = join(dbDir, 'expenses.db');

  // РџРµСЂРІС‹Р№ Р·Р°РїСѓСЃРє РЅР° СЌС‚РѕРј РєРѕРјРїСЊСЋС‚РµСЂРµ: СЂР°Р·РІРѕСЂР°С‡РёРІР°РµРј С€Р°Р±Р»РѕРЅРЅСѓСЋ Р‘Р” РёР· СѓСЃС‚Р°РЅРѕРІС‰РёРєР°
  if (!existsSync(dbPath)) {
    const template = getBundledTemplatePath();
    if (template) {
      try {
        copyFileSync(template, dbPath);
        console.log('[db] Р‘Р°Р·Р° СЃРѕР·РґР°РЅР° РёР· С€Р°Р±Р»РѕРЅР° СѓСЃС‚Р°РЅРѕРІС‰РёРєР°');
      } catch (err) {
        console.error('[db] РќРµ СѓРґР°Р»РѕСЃСЊ СЃРєРѕРїРёСЂРѕРІР°С‚СЊ С€Р°Р±Р»РѕРЅ Р‘Р”:', err);
      }
    }
  }

  return dbPath;
}

function initDatabase(): Database.Database {
  const dbPath = getDbPath();
  const existed = existsSync(dbPath);

  // Автокопия ДО изменения схемы: если миграция что-то испортит,
  // останется точка откката. Копия делается только для уже существующей БД,
  // чтобы не плодить пустые файлы при первом запуске.
  if (existed) {
    const backup = makeBackup(dbPath, 'auto');
    if (backup) {
      console.log('[backup] Автокопия:', backup);
    }
  }

  const database = new Database(dbPath);

  // Схема + дефолтные категории (идемпотентно).
  // Для БД из установщика это гарантирует актуальность структуры;
  // пользовательские данные не затрагиваются.
  applySchema(database);

  return database;
}

function createWindow() {
  const isMac = process.platform === 'darwin';

  mainWindow = new BrowserWindow({
    width: 1200,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    webPreferences: {
      preload: join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      additionalArguments: [`--app-platform=${process.platform}`],
    },
    // На macOS системные кнопки окна находятся СЛЕВА, поэтому используем
    // hiddenInset (он сам добавляет отступ под «светофор») и двигаем их вручную.
    // На Windows//Linux кнопки справа — там подходит hidden + titleBarOverlay.
    ...(isMac
      ? {
          titleBarStyle: 'hiddenInset' as const,
          trafficLightPosition: { x: 14, y: 13 },
        }
      : {
          titleBarStyle: 'hidden' as const,
          titleBarOverlay: {
            color: '#1a1a2e',
            symbolColor: '#ffffff',
            height: 36,
          },
        }),
    backgroundColor: '#0f0f1a',
  });

  if (isDev) {
    mainWindow.loadURL('http://localhost:5173');
    mainWindow.webContents.openDevTools();
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'));
  }

  // Обновление могло начаться до готовности окна — привязываем отправку статуса
  pushUpdateStatus(mainWindow);

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  db = initDatabase();
  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

app.on('before-quit', () => {
  if (db) db.close();
});

// IPC Handlers
ipcMain.handle('db:getCategories', () => {
  return db!.prepare(`
    SELECT c.*,
      (SELECT json_group_array(json_object(
                'id', s.id,
                'name', s.name,
                'is_custom', s.is_custom,
                'sort_order', s.sort_order,
                'items', (
                  SELECT json_group_array(json_object(
                             'id', si.id, 'name', si.name,
                             'is_custom', si.is_custom, 'sort_order', si.sort_order))
                  FROM (SELECT * FROM subitems WHERE subcategory_id = s.id ORDER BY sort_order) si)))
       FROM (SELECT * FROM subcategories WHERE category_id = c.id ORDER BY sort_order) s) as subcategories
    FROM categories c
    WHERE c.type = 'expense'
    ORDER BY c.sort_order
  `).all();
});

ipcMain.handle('db:addCategory', (_, name: string) => {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Название категории не может быть пустым');
  if (clean.length > 100) throw new Error('Название категории слишком длинное');

  // Литерал 'expense' обязательно в одинарных кавычках: better-sqlite3
  // собирает SQLite с отключённым DQS-режимом, и "expense" в двойных
  // кавычках трактуется как имя колонки -> "no such column: expense".
  const stmt = db!.prepare("INSERT INTO categories (name, type, is_custom, sort_order) VALUES (?, 'expense', 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM categories))");
  const result = stmt.run(clean);
  return { id: result.lastInsertRowid, name: clean, is_custom: 1 };
});

ipcMain.handle('db:addSubcategory', (_, categoryId: number, name: string) => {
  const stmt = db!.prepare('INSERT INTO subcategories (category_id, name, is_custom, sort_order) VALUES (?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subcategories WHERE category_id = ?))');
  const result = stmt.run(categoryId, name, categoryId);
  return { id: result.lastInsertRowid, name, is_custom: 1 };
});

/** Смена значка категории */
ipcMain.handle('db:setCategoryIcon', (_, id: number, icon: string | null) => {
  const clean = icon && typeof icon === 'string' ? icon.trim() : null;
  db!.prepare('UPDATE categories SET icon = ? WHERE id = ?').run(clean || null, id);
  return { success: true };
});

/** Смена цвета категории — этот цвет используется на графиках */
ipcMain.handle('db:setCategoryColor', (_, id: number, color: string | null) => {
  const clean = color && typeof color === 'string' ? color.trim() : null;
  db!.prepare('UPDATE categories SET color = ? WHERE id = ?').run(clean || null, id);
  return { success: true };
});

// ——— Третий уровень (статьи) ———
ipcMain.handle('db:addSubitem', (_, subcategoryId: number, name: string) => {
  const clean = (name || '').trim();
  if (!clean) throw new Error('Название статьи не может быть пустым');
  const stmt = db!.prepare(
    `INSERT OR IGNORE INTO subitems (subcategory_id, name, is_custom, sort_order)
     VALUES (?, ?, 1, (SELECT COALESCE(MAX(sort_order), 0) + 1 FROM subitems WHERE subcategory_id = ?))`
  );
  const result = stmt.run(subcategoryId, clean, subcategoryId);
  return { id: result.lastInsertRowid, name: clean, is_custom: 1 };
});

ipcMain.handle('db:deleteSubitem', (_, id: number) => {
  const run = db!.transaction((itemId: number) => {
    db!.prepare('DELETE FROM expenses WHERE subitem_id = ?').run(itemId);
    db!.prepare('DELETE FROM subitems WHERE id = ?').run(itemId);
  });
  run(id);
  return { success: true };
});

// ——— Резервные копии ———
ipcMain.handle('db:makeBackup', () => {
  const dbPath = getDbPath();
  const dest = makeBackup(dbPath, 'manual');
  if (!dest) throw new Error('Не удалось создать резервную копию');
  return { path: dest };
});

ipcMain.handle('db:getBackups', () => {
  const dir = getBackupsDir();
  try {
    return readdirSync(dir)
      .filter((f) => f.startsWith('expenses-') && f.endsWith('.db'))
      .map((f) => {
        const full = join(dir, f);
        return { name: f, path: full, size: statSync(full).size };
      })
      .sort((a, b) => (a.name < b.name ? 1 : -1));
  } catch {
    return [];
  }
});

/**
 * Сколько трат и подкатегорий будет затронуто удалением.
 * Интерфейс показывает это в подтверждении, чтобы удаление не было сюрпризом.
 */
ipcMain.handle(
  'db:getDeleteImpact',
  (_, kind: 'category' | 'subcategory' | 'subitem', id: number) => {
    if (kind === 'category') {
      const expenses = db!.prepare('SELECT COUNT(*) c FROM expenses WHERE category_id = ?').get(id) as {
        c: number;
      };
      const subs = db!.prepare('SELECT COUNT(*) c FROM subcategories WHERE category_id = ?').get(id) as {
        c: number;
      };
      const items = db!.prepare(
        `SELECT COUNT(*) c FROM subitems
         WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)`
      ).get(id) as { c: number };
      return { expenses: expenses.c, subcategories: subs.c, subitems: items.c };
    }
    if (kind === 'subitem') {
      const expenses = db!.prepare('SELECT COUNT(*) c FROM expenses WHERE subitem_id = ?').get(id) as {
        c: number;
      };
      return { expenses: expenses.c, subcategories: 0, subitems: 0 };
    }
    const expenses = db!.prepare(
      `SELECT COUNT(*) c FROM expenses
       WHERE subcategory_id = ?
          OR subitem_id IN (SELECT id FROM subitems WHERE subcategory_id = ?)`
    ).get(id, id) as { c: number };
    const items = db!.prepare('SELECT COUNT(*) c FROM subitems WHERE subcategory_id = ?').get(id) as {
      c: number;
    };
    return { expenses: expenses.c, subcategories: 0, subitems: items.c };
  }
);

/**
 * Удаление категории. Разрешено и для встроенных («Закуп», «Такси») —
 * ограничения на is_custom больше нет.
 * Траты этой категории удаляются вместе с ней: оставить их было бы хуже,
 * т.к. в списках они выбираются INNER JOIN'ом по категории и просто исчезли бы
 * из интерфейса вместе с суммами в отчёте.
 */
ipcMain.handle('db:deleteCategory', (_, id: number) => {
  const row = db!.prepare('SELECT name, is_custom FROM categories WHERE id = ?').get(id) as
    | { name: string; is_custom: number }
    | undefined;

  const run = db!.transaction((categoryId: number, name: string, isCustom: number) => {
    // Встроенную категорию запоминаем как удалённую, иначе applySchema()
    // создаст её заново при следующем запуске.
    if (isCustom === 0) {
      db!.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
      ).run(`deleted_default:${name}`);
    }
    db!.prepare('DELETE FROM expenses WHERE category_id = ?').run(categoryId);
    db!.prepare(
      `DELETE FROM expenses WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)`
    ).run(categoryId);
    db!.prepare(
      `DELETE FROM subitems WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)`
    ).run(categoryId);
    db!.prepare('DELETE FROM subcategories WHERE category_id = ?').run(categoryId);
    db!.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  if (!row) throw new Error('Категория не найдена');
  run(id, row.name, row.is_custom);
  return { success: true };
});

ipcMain.handle('db:deleteSubcategory', (_, id: number) => {
  const row = db!.prepare(`
      SELECT s.name, s.is_custom, c.name AS category_name
      FROM subcategories s JOIN categories c ON c.id = s.category_id
      WHERE s.id = ?
    `).get(id) as { name: string; is_custom: number; category_name: string } | undefined;
  if (!row) throw new Error('Подкатегория не найдена');

  const run = db!.transaction((subId: number) => {
    // Встроенную подкатегорию запоминаем, иначе applySchema() создаст её заново
    if (row.is_custom === 0) {
      db!.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
      ).run(`deleted_sub:${row.category_name}:${row.name}`);
    }
    db!.prepare(
      `DELETE FROM expenses WHERE subitem_id IN (SELECT id FROM subitems WHERE subcategory_id = ?)`
    ).run(subId);
    db!.prepare('DELETE FROM expenses WHERE subcategory_id = ?').run(subId);
    db!.prepare('DELETE FROM subitems WHERE subcategory_id = ?').run(subId);
    db!.prepare('DELETE FROM subcategories WHERE id = ?').run(subId);
  });
  run(id);
  return { success: true };
});

ipcMain.handle('db:getExpenses', (_, { startDate, endDate }: { startDate: string; endDate: string }) => {
  return db!.prepare(`
    SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
           s.name as subcategory_name, si.name as subitem_name
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    LEFT JOIN subcategories s ON e.subcategory_id = s.id
    LEFT JOIN subitems si ON e.subitem_id = si.id
    WHERE date(e.date) BETWEEN date(?) AND date(?)
    ORDER BY date(e.date) DESC, e.created_at DESC
  `).all(startDate, endDate);
});

ipcMain.handle('db:addExpense', (_, expense: { categoryId: number; subcategoryId?: number; subitemId?: number; amount: number; date: string; note?: string }) => {
  const stmt = db!.prepare('INSERT INTO expenses (category_id, subcategory_id, subitem_id, amount, date, note) VALUES (?, ?, ?, ?, ?, ?)');
  const result = stmt.run(
    expense.categoryId,
    expense.subcategoryId || null,
    expense.subitemId || null,
    expense.amount,
    expense.date,
    expense.note || null
  );
  return { id: result.lastInsertRowid, ...expense };
});

ipcMain.handle('db:deleteExpense', (_, id: number) => {
  db!.prepare('DELETE FROM expenses WHERE id = ?').run(id);
  return { success: true };
});

/** Трата целиком — нужна для возврата удалённой записи */
interface RestorableExpense {
  id: number;
  category_id: number;
  subcategory_id: number | null;
  subitem_id: number | null;
  amount: number;
  date: string;
  note: string | null;
  created_at: string;
}

/** Внесение целиком — нужно для возврата удалённой записи */
interface RestorableDeposit {
  id: number;
  amount: number;
  date: string;
  category_id: number | null;
  note: string | null;
  created_at: string;
}

/**
 * Возврат удалённой траты для отмены удаления.
 *
 * Запись вставляется с тем же id, что была до удаления, иначе в таблице
 * появился бы дубль при следующем добавлении: AUTOINCREMENT продолжает
 * счёт от максимального id, а не от того, который занимала удалённая строка.
 */
ipcMain.handle('db:restoreExpense', (_, expense: RestorableExpense) => {
  db!.prepare(
    `INSERT INTO expenses (id, category_id, subcategory_id, subitem_id, amount, date, note, created_at)
     VALUES (@id, @category_id, @subcategory_id, @subitem_id, @amount, @date, @note, @created_at)`
  ).run({
    id: expense.id,
    category_id: expense.category_id,
    subcategory_id: expense.subcategory_id ?? null,
    subitem_id: expense.subitem_id ?? null,
    amount: expense.amount,
    date: expense.date,
    note: expense.note ?? null,
    created_at: expense.created_at,
  });
  return { success: true };
});

/**
 * Производный остаток денег на указанную дату (включительно).
 *
 * База — последняя отметка «Указать остаток», не позже этой даты.
 * К ней прибавляются все внесения и вычитаются все траты, которые произошли
 * ПОСЛЕ отметки и до этой даты. Так текущий остаток и отчёт за период
 * показывают одну и ту же согласованную сумму.
 *
 * Важно: сравнение идёт по паре (дата, время создания записи), а не только
 * по дате. Иначе операция, внесённая в тот же день, что и отметка остатка,
 * игнорировалась бы — пользователь поставил остаток 100 000, внёс 50 000
 * в тот же день, а остаток не изменился бы.
 */
function getDerivedBalanceAt(dateStr: string): {
  balance: number;
  base: number;
  baseDate: string | null;
} {
  const row = db!.prepare(`
    WITH cp AS (
      SELECT amount, date(date) AS d, created_at AS ca
      FROM balance_history
      WHERE date(date) <= date(?)
      ORDER BY date(date) DESC, created_at DESC
      LIMIT 1
    )
    SELECT
      COALESCE((SELECT amount FROM cp), 0)
        + COALESCE((SELECT SUM(amount) FROM deposits
            WHERE (
                    date(date) > COALESCE((SELECT d FROM cp), '0000-01-01')
                 OR (date(date) = COALESCE((SELECT d FROM cp), '0000-01-01')
                     AND created_at > COALESCE((SELECT ca FROM cp), ''))
                  )
              AND date(date) <= date(?)), 0)
        - COALESCE((SELECT SUM(amount) FROM expenses
            WHERE (
                    date(date) > COALESCE((SELECT d FROM cp), '0000-01-01')
                 OR (date(date) = COALESCE((SELECT d FROM cp), '0000-01-01')
                     AND created_at > COALESCE((SELECT ca FROM cp), ''))
                  )
              AND date(date) <= date(?)), 0)
      AS balance,
      COALESCE((SELECT amount FROM cp), 0) AS base,
      (SELECT d FROM cp) AS base_date
  `).get(dateStr, dateStr, dateStr) as {
    balance: number;
    base: number;
    base_date: string | null;
  };

  return {
    balance: row.balance ?? 0,
    base: row.base ?? 0,
    baseDate: row.base_date ?? null,
  };
}

ipcMain.handle('db:getBalanceHistory', () => {
  return db!.prepare('SELECT * FROM balance_history ORDER BY date DESC, created_at DESC').all();
});

/** Текущий остаток с учётом внесений и трат */
ipcMain.handle('db:getCurrentBalance', () => {
  const today = new Date();
  const y = today.getFullYear();
  const m = String(today.getMonth() + 1).padStart(2, '0');
  const d = String(today.getDate()).padStart(2, '0');
  return getDerivedBalanceAt(`${y}-${m}-${d}`);
});

ipcMain.handle('db:addBalance', (_, balance: { amount: number; date: string; note?: string }) => {
  const stmt = db!.prepare('INSERT INTO balance_history (amount, date, note) VALUES (?, ?, ?)');
  const result = stmt.run(balance.amount, balance.date, balance.note || null);
  return { id: result.lastInsertRowid, ...balance };
});

ipcMain.handle('db:deleteBalance', (_, id: number) => {
  db!.prepare('DELETE FROM balance_history WHERE id = ?').run(id);
  return { success: true };
});

// ——— Внесения денег ———
ipcMain.handle('db:getDeposits', (_, { startDate, endDate }: { startDate: string; endDate: string }) => {
  return db!.prepare(`
    SELECT d.*, c.name as category_name
    FROM deposits d
    LEFT JOIN deposit_categories c ON d.category_id = c.id
    WHERE date(d.date) BETWEEN date(?) AND date(?)
    ORDER BY date(d.date) DESC, d.created_at DESC
  `).all(startDate, endDate);
});

// ——— Категории внесений ———
ipcMain.handle('db:getDepositCategories', () => {
  return db!.prepare(`
    SELECT c.*, (
      SELECT COUNT(*) FROM deposits d WHERE d.category_id = c.id
    ) as deposits_count
    FROM deposit_categories c
    ORDER BY c.sort_order, c.name
  `).all();
});

ipcMain.handle('db:addDepositCategory', (_, name: string) => {
  const clean = (name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Название категории внесения не может быть пустым');

  // Сравнение без учёта регистра делаем в JS: better-sqlite3 собран без ICU,
  // поэтому NOCASE и lower() в SQLite не различают «зарплата» и «Зарплата»,
  // и UNIQUE на name такие дубли не отсекает.
  const create = db!.transaction((finalName: string) => {
    const all = db!
      .prepare(`SELECT id, name FROM deposit_categories`)
      .all() as { id: number; name: string }[];
    const target = finalName.toLowerCase();
    const existing = all.find((c) => c.name.trim().toLowerCase() === target);
    if (existing) return { id: existing.id, name: existing.name };

    const order = db!
      .prepare(`SELECT COALESCE(MAX(sort_order), 0) + 1 AS next FROM deposit_categories`)
      .get() as { next: number };
    const result = db!
      .prepare(`INSERT INTO deposit_categories (name, sort_order) VALUES (?, ?)`)
      .run(finalName, order.next);
    return { id: result.lastInsertRowid, name: finalName };
  });
  return create(clean);
});

ipcMain.handle('db:deleteDepositCategory', (_, id: number) => {
  // Внесения не удаляем — терять деньги из-за удаления справочника нельзя.
  // Категория у них просто пропадает, суммы и даты остаются.
  const run = db!.transaction((catId: number) => {
    db!.prepare(`UPDATE deposits SET category_id = NULL WHERE category_id = ?`).run(catId);
    db!.prepare(`DELETE FROM deposit_categories WHERE id = ?`).run(catId);
  });
  run(id);
  return { success: true };
});

ipcMain.handle('db:setDepositCategoryColor', (_, id: number, color: string | null) => {
  const clean = color && typeof color === 'string' ? color.trim() : null;
  db!.prepare(`UPDATE deposit_categories SET color = ? WHERE id = ?`).run(clean || null, id);
  return { success: true };
});

ipcMain.handle('db:addDeposit', (_, deposit: { amount: number; date: string; categoryId: number }) => {
  // Валидация на сервере: дублируем проверки из UI, чтобы обойти их было нельзя.
  const amount = Number(deposit.amount);
  const categoryId = Number(deposit.categoryId);

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Сумма внесения должна быть больше нуля');
  }
  if (!Number.isFinite(categoryId) || categoryId <= 0) {
    throw new Error('Выберите категорию внесения');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deposit.date || '')) {
    throw new Error('Некорректная дата');
  }
  const category = db!
    .prepare(`SELECT name FROM deposit_categories WHERE id = ?`)
    .get(categoryId) as { name: string } | undefined;
  if (!category) {
    throw new Error('Категория внесения не найдена');
  }

  const stmt = db!.prepare(
    `INSERT INTO deposits (amount, date, category_id) VALUES (?, ?, ?)`
  );
  const result = stmt.run(amount, deposit.date, categoryId);
  return {
    id: result.lastInsertRowid,
    amount,
    date: deposit.date,
    category_id: categoryId,
    category_name: category.name,
  };
});

ipcMain.handle('db:deleteDeposit', (_, id: number) => {
  db!.prepare('DELETE FROM deposits WHERE id = ?').run(id);
  return { success: true };
});

/**
 * Возврат удалённого внесения. Как и у траты, id сохраняется: иначе после
 * отмены удаления в таблице появился бы дубль.
 */
ipcMain.handle('db:restoreDeposit', (_, deposit: RestorableDeposit) => {
  db!.prepare(
    `INSERT INTO deposits (id, amount, date, category_id, note, created_at)
     VALUES (@id, @amount, @date, @category_id, @note, @created_at)`
  ).run({
    id: deposit.id,
    amount: deposit.amount,
    date: deposit.date,
    category_id: deposit.category_id ?? null,
    note: deposit.note ?? null,
    created_at: deposit.created_at,
  });
  return { success: true };
});

ipcMain.handle('db:getReport', (_, { startDate, endDate }: { startDate: string; endDate: string }) => {
  // Отметка «Указать остаток» — жёсткий сброс базы. Если она попадает ВНУТРЬ
  // периода, именно она становится началом отсчёта: операции до неё уже учтены
  // в её сумме, иначе они посчитались бы дважды, а карточки отчёта не сошлись бы.
  const cpInPeriod = db!.prepare(`
    SELECT amount, date(date) AS d, created_at AS ca
    FROM balance_history
    WHERE date(date) BETWEEN date(?) AND date(?)
    ORDER BY date(date) DESC, created_at DESC
    LIMIT 1
  `).get(startDate, endDate) as
    | { amount: number; d: string; ca: string }
    | undefined;

  // Операции, записанные ПОЗЖЕ отметки (по дате, а при совпадении — по времени)
  const AFTER_CP = `(
      date(date) > ?
   OR (date(date) = ? AND created_at > ?)
  ) AND date(date) <= ?`;

  const EXPENSE_SELECT = `
    SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
           s.name as subcategory_name, si.name as subitem_name
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    LEFT JOIN subcategories s ON e.subcategory_id = s.id
    LEFT JOIN subitems si ON e.subitem_id = si.id`;

  let startAmount: number;
  let baseCheckpoint: { amount: number; date: string | null };
  let expenses: Array<{
    amount: number;
    category_name: string;
    category_icon?: string | null;
    category_color?: string | null;
    subcategory_name?: string | null;
    subitem_name?: string | null;
    date: string;
  }>;
  let deposits: Array<{
    amount: number;
    date: string;
    category_id?: number | null;
    category_name?: string | null;
    category_color?: string | null;
  }>;

  const DEPOSIT_SELECT = `
    SELECT d.*, c.name as category_name, c.color as category_color
    FROM deposits d
    LEFT JOIN deposit_categories c ON d.category_id = c.id`;
  // AFTER_CP написан без алиасов — после JOIN колонка date станет неоднозначной.
  const DEPOSIT_AFTER_CP = `(
      date(d.date) > ?
   OR (date(d.date) = ? AND d.created_at > ?)
  ) AND date(d.date) <= ?`;

  if (cpInPeriod) {
    startAmount = cpInPeriod.amount;
    baseCheckpoint = { amount: cpInPeriod.amount, date: cpInPeriod.d };
    expenses = db!.prepare(
      `${EXPENSE_SELECT}
       WHERE ${AFTER_CP}
       ORDER BY date(e.date) DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof expenses;
    deposits = db!.prepare(
      `${DEPOSIT_SELECT} WHERE ${DEPOSIT_AFTER_CP}
       ORDER BY date(d.date) DESC, d.created_at DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof deposits;
  } else {
    const start = getDerivedBalanceAt(startDate);
    startAmount = start.balance;
    baseCheckpoint = { amount: start.base, date: start.baseDate };
    expenses = db!.prepare(
      `${EXPENSE_SELECT}
       WHERE date(e.date) BETWEEN date(?) AND date(?)
       ORDER BY date(e.date) DESC`
    ).all(startDate, endDate) as typeof expenses;
    deposits = db!.prepare(
      `${DEPOSIT_SELECT}
       WHERE date(d.date) BETWEEN date(?) AND date(?)
       ORDER BY date(d.date) DESC, d.created_at DESC`
    ).all(startDate, endDate) as typeof deposits;
  }

  // Остаток на конец периода — производный, включает все операции периода
  const end = getDerivedBalanceAt(endDate);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);

  // Разбивка по трём уровням. Цвет берём из настройки категории — именно
  // его пользователь выбирает для графика.
  const byCategory = expenses.reduce((acc, e) => {
    const key = e.category_name;
    if (!acc[key]) {
      acc[key] = { total: 0, color: e.category_color || null, subcategories: {} };
    }
    acc[key].total += e.amount;
    if (!acc[key].color && e.category_color) acc[key].color = e.category_color;

    if (e.subcategory_name) {
      const sub = acc[key].subcategories[e.subcategory_name];
      if (!sub) {
        acc[key].subcategories[e.subcategory_name] = { total: 0, items: {} };
      }
      acc[key].subcategories[e.subcategory_name].total += e.amount;
      if (e.subitem_name) {
        const items = acc[key].subcategories[e.subcategory_name].items;
        items[e.subitem_name] = (items[e.subitem_name] || 0) + e.amount;
      }
    }
    return acc;
  }, {} as Record<
    string,
    {
      total: number;
      color: string | null;
      subcategories: Record<string, { total: number; items: Record<string, number> }>;
    }
  >);

  // Внесения по категориям — тот же принцип, что и у трат.
  // Внесения без категории возможны только после удаления категории,
  // поэтому для них отдельный ключ, чтобы сумма не потерялась.
  const byDepositCategory = deposits.reduce((acc, d) => {
    const key = d.category_name || 'Без категории';
    if (!acc[key]) acc[key] = { total: 0, color: d.category_color || null };
    acc[key].total += d.amount;
    if (!acc[key].color && d.category_color) acc[key].color = d.category_color;
    return acc;
  }, {} as Record<string, { total: number; color: string | null }>);

  return {
    startBalance: startAmount,
    // Деньги на выходе: после всех внесений и вычетов
    endBalance: end.balance,
    totalExpenses,
    totalDeposits,
    baseCheckpoint,
    expenses,
    deposits,
    byCategory,
    byDepositCategory,
    period: { startDate, endDate },
  };
});

/**
 * Экспорт отчёта в Excel с нативными графиками.
 * Файл собирает наш генератор OOXML: готовые библиотеки графики не умеют.
 */
ipcMain.handle('report:exportXlsx', async (_, payload: ReportXlsxPayload) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    defaultPath: `Отчёт ${payload.period || ''}.xlsx`.trim(),
    filters: [{ name: 'Excel Files', extensions: ['xlsx'] }],
  });
  if (canceled || !filePath) return { success: false };

  const MONEY = '#,##0.00';
  const isNum = (v: number | null | undefined) =>
    typeof v === 'number' && Number.isFinite(v) ? v : 0;

  // ——— Лист «Отчёт» ———
  const rows: (string | number | { value: string | number; bold?: boolean; fill?: string; numFmt?: string } | null)[][] = [
    [{ value: payload.title || 'Отчёт', bold: true }],
    [{ value: `Период: ${payload.period}`, bold: false }],
    [],
    [{ value: 'Показатель', bold: true }, { value: 'Сумма, ₸', bold: true }],
    [{ value: 'Начало (база)', bold: true }, { value: isNum(payload.startBalance), numFmt: MONEY }],
    [{ value: 'Внесения за период', bold: true }, { value: isNum(payload.totalDeposits), numFmt: MONEY }],
    [{ value: 'Траты за период', bold: true }, { value: isNum(payload.totalExpenses), numFmt: MONEY }],
    [{ value: 'На выходе', bold: true }, { value: isNum(payload.endBalance), numFmt: MONEY, fill: '#00d4aa' }],
  ];

  if (payload.checkpoint?.date) {
    rows.push([
      { value: `Базовая отметка: ${isNum(payload.checkpoint.amount)} ₸ от ${payload.checkpoint.date}` },
    ]);
  }

  // Дублируем итоговые внесения в конце отчёта — так же, как в интерфейсе
  rows.push([]);
  rows.push([{ value: 'Все внесения за период (итого)', bold: true }, { value: isNum(payload.totalDeposits), bold: true, numFmt: MONEY }]);
  for (const d of payload.depositRows) {
    rows.push([`  ${d.date}`, d.category || 'Без категории', { value: isNum(d.amount), numFmt: MONEY }]);
  }

  rows.push([]);
  rows.push([
    { value: 'Дата', bold: true },
    { value: 'Категория', bold: true },
    { value: 'Подкатегория', bold: true },
    { value: 'Статья', bold: true },
    { value: 'Сумма, ₸', bold: true },
    { value: 'Комментарий', bold: true },
  ]);
  for (const e of payload.expenseRows) {
    rows.push([
      e.date,
      e.category,
      e.subcategory,
      e.item,
      { value: isNum(e.amount), numFmt: MONEY },
      e.note,
    ]);
  }

  const charts = [
    {
      type: 'doughnut' as const,
      title: 'Расходы по категориям',
      points: payload.expenseByCategory.map((c) => ({
        label: c.name,
        value: isNum(c.total),
        color: c.color || '#888888',
      })),
      anchor: { fromCol: 6, fromRow: 1, toCol: 14, toRow: 20 },
    },
    {
      type: 'doughnut' as const,
      title: 'Приход по категориям',
      points: payload.depositByCategory.map((c) => ({
        label: c.name,
        value: isNum(c.total),
        color: c.color || '#888888',
      })),
      anchor: { fromCol: 6, fromRow: 22, toCol: 14, toRow: 41 },
    },
    {
      type: 'bar' as const,
      title: 'Динамика по дням',
      series: [
        {
          name: 'Траты',
          color: '#ff4757',
          points: payload.byDay.map((d) => ({ label: d.label, value: isNum(d.expense) })),
        },
        {
          name: 'Внесения',
          color: '#00d4aa',
          points: payload.byDay.map((d) => ({ label: d.label, value: isNum(d.deposit) })),
        },
      ],
      points: [],
      anchor: { fromCol: 6, fromRow: 43, toCol: 14, toRow: 62 },
    },
  ].filter((c) => (c.type === 'bar' ? true : c.points.length > 0));

  // Генератор Excel тянет за собой jszip (~45 мс на разбор), а нужен он
  // только при экспорте. Ленивый импорт убирает эти 45 мс из запуска.
  const { buildXlsx } = await import('./xlsx');

  const buf = await buildXlsx([
    {
      name: 'Отчёт',
      columns: [{ width: 30 }, { width: 20 }, { width: 18 }, { width: 18 }, { width: 16 }, { width: 28 }],
      rows,
      charts,
    },
  ]);

  const fs = await import('fs');
  fs.writeFileSync(filePath, buf);
  return { success: true, path: filePath };
});

// ——— Регулярные платежи ———

type RecurringFrequency = 'daily' | 'weekly' | 'monthly' | 'quarterly' | 'yearly';

/** Текущая дата в формате YYYY-MM-DD по местному времени */
function todayISO(): string {
  const now = new Date();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const d = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${m}-${d}`;
}

/**
 * Разбирает YYYY-MM-DD в части без создания Date.
 *
 * new Date('2026-01-31') разбирается как UTC и в местном поясе может
 * съехать на 30 января или 1 марта. Сравнение дат в SQL идёт как строки,
 * поэтому здесь важно вернуть ровно те части, что были во входе.
 */
function parseISODate(iso: string): { y: number; m: number; d: number } {
  const [y, m, d] = iso.split('-').map(Number);
  return { y, m, d };
}

/** Количество дней в месяце; m — от 1 до 12 */
function daysInMonth(y: number, m: number): number {
  // День 0 следующего месяца — последний день текущего
  return new Date(y, m, 0).getDate();
}

/**
 * Прибавляет период к дате регулярного платежа.
 *
 * Для месяца, квартала и года день обрезается по длине целевого месяца:
 * без этого аренда за 31 число из января уехала бы на 3 марта, потому что
 * в феврале 31-го дня нет. Наивное прибавление через setMonth переполняет
 * месяц именно так.
 */
function advanceRecurringDate(iso: string, frequency: RecurringFrequency): string {
  const { y, m, d } = parseISODate(iso);

  if (frequency === 'daily' || frequency === 'weekly') {
    const days = frequency === 'daily' ? 1 : 7;
    const dt = new Date(y, m - 1, d + days);
    const mm = String(dt.getMonth() + 1).padStart(2, '0');
    const dd = String(dt.getDate()).padStart(2, '0');
    return `${dt.getFullYear()}-${mm}-${dd}`;
  }

  const step = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const totalMonths = (y * 12 + (m - 1)) + step;
  const ny = Math.floor(totalMonths / 12);
  const nm = (totalMonths % 12) + 1;
  const nd = Math.min(d, daysInMonth(ny, nm));

  const mm = String(nm).padStart(2, '0');
  const dd = String(nd).padStart(2, '0');
  return `${ny}-${mm}-${dd}`;
}

/**
 * Двигает дату вперёд, пока она не окажется в будущем.
 *
 * Нужна для отставания: если платёж не отмечали три месяца, одна отметка
 * «оплачено» должна погасить весь долг, а не оставлять два просроченных.
 */
function advanceUntilFuture(iso: string, frequency: RecurringFrequency, today: string): string {
  let next = iso;
  // Ограничение на итерации — подстраховка от бесконечного цикла
  for (let i = 0; i < 1000 && next <= today; i++) {
    next = advanceRecurringDate(next, frequency);
  }
  return next;
}

const RECURRING_SELECT = `
  SELECT r.*, c.name AS category_name, c.icon AS category_icon, c.color AS category_color,
         s.name AS subcategory_name
  FROM recurring r
  JOIN categories c ON r.category_id = c.id
  LEFT JOIN subcategories s ON r.subcategory_id = s.id
`;

/** Активные платежи, срок которых наступил или прошёл */
ipcMain.handle('db:getDueRecurring', () => {
  const today = todayISO();
  return db!.prepare(
    `${RECURRING_SELECT} WHERE r.is_active = 1 AND r.next_date <= ? ORDER BY r.next_date, r.title`
  ).all(today);
});

/** Все платёжи, включая выключенные — для экрана настройки */
ipcMain.handle('db:getRecurring', () => {
  return db!.prepare(`${RECURRING_SELECT} ORDER BY r.is_active DESC, r.next_date`).all();
});

ipcMain.handle('db:addRecurring', (_, p: {
  title: string;
  categoryId: number;
  subcategoryId?: number;
  subitemId?: number;
  amount: number;
  frequency: RecurringFrequency;
  nextDate: string;
}) => {
  const info = db!.prepare(
    `INSERT INTO recurring (title, category_id, subcategory_id, subitem_id, amount, frequency, next_date)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run(
    p.title.trim(),
    p.categoryId,
    p.subcategoryId ?? null,
    p.subitemId ?? null,
    p.amount,
    p.frequency,
    p.nextDate
  );
  return { success: true, id: Number(info.lastInsertRowid) };
});

ipcMain.handle('db:updateRecurring', (_, id: number, patch: Partial<{
  title: string;
  amount: number;
  frequency: RecurringFrequency;
  nextDate: string;
  isActive: boolean;
}>) => {
  const current = db!.prepare('SELECT * FROM recurring WHERE id = ?').get(id) as
    | {
        title: string;
        amount: number;
        frequency: RecurringFrequency;
        next_date: string;
        is_active: number;
      }
    | undefined;
  if (!current) return { success: false, message: 'Платёж не найден' };

  db!.prepare(
    `UPDATE recurring SET title = ?, amount = ?, frequency = ?, next_date = ?, is_active = ?
     WHERE id = ?`
  ).run(
    patch.title?.trim() ?? current.title,
    patch.amount ?? current.amount,
    patch.frequency ?? current.frequency,
    patch.nextDate ?? current.next_date,
    (patch.isActive === undefined ? current.is_active : patch.isActive ? 1 : 0),
    id
  );
  return { success: true };
});

ipcMain.handle('db:deleteRecurring', (_, id: number) => {
  db!.prepare('DELETE FROM recurring WHERE id = ?').run(id);
  return { success: true };
});

/**
 * Отметка «оплачено»: создаёт трату и сдвигает платёж на следующий период.
 *
 * Обе операции идут в одной транзакции. Иначе при сбое между ними получилось
 * бы либо потерянное внесение, либо платёж, который никогда не спишется.
 */
ipcMain.handle('db:payRecurring', (_, id: number) => {
  const today = todayISO();
  const row = db!.prepare('SELECT * FROM recurring WHERE id = ?').get(id) as
    | {
        title: string;
        category_id: number;
        subcategory_id: number | null;
        subitem_id: number | null;
        amount: number;
        frequency: RecurringFrequency;
        next_date: string;
      }
    | undefined;

  if (!row) return { success: false, message: 'Платёж не найден' };

  // Тратой становится дата наступления, а не сегодня: если аренда была
  // должна прийти 1-го, а отмечена 3-го, в статистике она должна лежать
  // в том месяце, который оплачивали.
  const expenseDate = row.next_date < today ? row.next_date : today;
  const nextDate = advanceUntilFuture(row.next_date, row.frequency, today);

  const pay = db!.transaction(() => {
    db!.prepare(
      `INSERT INTO expenses (category_id, subcategory_id, subitem_id, amount, date, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(
      row.category_id,
      row.subcategory_id,
      row.subitem_id,
      row.amount,
      expenseDate,
      row.title
    );
    db!.prepare('UPDATE recurring SET next_date = ? WHERE id = ?').run(nextDate, id);
  });
  pay();

  return { success: true, nextDate, expenseDate };
});

/**
 * Сумма постоянных расходов в месяц.
 *
 * Дневные и недельные платежи пересчитываются в месяц, остальные берутся
 * как есть. Это ориентир для планирования, а не точная сумма: платежи могут
 * попадать на разные даты.
 */
ipcMain.handle('db:getRecurringMonthlyTotal', () => {
  const rows = db!.prepare(
    `SELECT amount, frequency FROM recurring WHERE is_active = 1`
  ).all() as { amount: number; frequency: RecurringFrequency }[];

  const perMonth: Record<RecurringFrequency, number> = {
    daily: 30,
    weekly: 4.345,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  };

  return rows.reduce((sum, r) => sum + r.amount * perMonth[r.frequency], 0);
});

// ——— Обновление приложения ———
/**
 * Состояние обновления дублируется в окно при каждом изменении: загрузка
 * идёт в главном процессе, а окно могло перерисоваться или обновить период.
 */
function pushUpdateStatus(target: Electron.BrowserWindow | null): void {
  onUpdateStatus((status) => {
    if (target && !target.isDestroyed()) {
      target.webContents.send('update:status', status);
    }
  });
}

ipcMain.handle('update:check', async () => {
  return checkForUpdates();
});

ipcMain.handle('update:download', async () => {
  return downloadUpdate();
});

ipcMain.handle('update:install', async () => {
  return installUpdate();
});

ipcMain.handle('update:status', () => ({
  ...getUpdateStatus(),
  releaseUrl: RELEASE_URL,
  supported: supportsAutoUpdate(),
}));

ipcMain.handle('update:openReleasePage', async () => {
  await shell.openExternal(RELEASE_URL);
  return { success: true };
});

ipcMain.handle('dialog:saveFile', async (_, defaultPath: string, content: string) => {
  const { canceled, filePath } = await dialog.showSaveDialog(mainWindow!, {
    defaultPath,
    filters: [{ name: 'CSV Files', extensions: ['csv'] }, { name: 'Text Files', extensions: ['txt'] }],
  });
  if (!canceled && filePath) {
    const fs = await import('fs');
    fs.writeFileSync(filePath, content, 'utf-8');
    return { success: true, path: filePath };
  }
  return { success: false };
});
