import { app, BrowserWindow, ipcMain, dialog } from 'electron';
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
      (SELECT json_group_array(json_object('id', s.id, 'name', s.name, 'is_custom', s.is_custom, 'sort_order', s.sort_order))
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
ipcMain.handle('db:getDeleteImpact', (_, kind: 'category' | 'subcategory', id: number) => {
  if (kind === 'category') {
    const expenses = db!.prepare('SELECT COUNT(*) c FROM expenses WHERE category_id = ?').get(id) as { c: number };
    const subs = db!.prepare('SELECT COUNT(*) c FROM subcategories WHERE category_id = ?').get(id) as { c: number };
    return { expenses: expenses.c, subcategories: subs.c };
  }
  const expenses = db!.prepare('SELECT COUNT(*) c FROM expenses WHERE subcategory_id = ?').get(id) as {
    c: number;
  };
  return { expenses: expenses.c, subcategories: 0 };
});

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
    db!.prepare('DELETE FROM expenses WHERE subcategory_id = ?').run(subId);
    db!.prepare('DELETE FROM subcategories WHERE id = ?').run(subId);
  });
  run(id);
  return { success: true };
});

ipcMain.handle('db:getExpenses', (_, { startDate, endDate }: { startDate: string; endDate: string }) => {
  return db!.prepare(`
    SELECT e.*, c.name as category_name, c.icon as category_icon, s.name as subcategory_name
    FROM expenses e
    JOIN categories c ON e.category_id = c.id
    LEFT JOIN subcategories s ON e.subcategory_id = s.id
    WHERE date(e.date) BETWEEN date(?) AND date(?)
    ORDER BY date(e.date) DESC, e.created_at DESC
  `).all(startDate, endDate);
});

ipcMain.handle('db:addExpense', (_, expense: { categoryId: number; subcategoryId?: number; amount: number; date: string; note?: string }) => {
  const stmt = db!.prepare('INSERT INTO expenses (category_id, subcategory_id, amount, date, note) VALUES (?, ?, ?, ?, ?)');
  const result = stmt.run(expense.categoryId, expense.subcategoryId || null, expense.amount, expense.date, expense.note || null);
  return { id: result.lastInsertRowid, ...expense };
});

ipcMain.handle('db:deleteExpense', (_, id: number) => {
  db!.prepare('DELETE FROM expenses WHERE id = ?').run(id);
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
    SELECT * FROM deposits
    WHERE date(date) BETWEEN date(?) AND date(?)
    ORDER BY date(date) DESC, created_at DESC
  `).all(startDate, endDate);
});

ipcMain.handle('db:addDeposit', (_, deposit: { amount: number; date: string; note: string }) => {
  // Валидация на сервере: комментарий обязателен (дублируем CHECK из схемы)
  const amount = Number(deposit.amount);
  const note = (deposit.note || '').trim();

  if (!Number.isFinite(amount) || amount <= 0) {
    throw new Error('Сумма внесения должна быть больше нуля');
  }
  if (!note) {
    throw new Error('Укажите комментарий к внесению');
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(deposit.date || '')) {
    throw new Error('Некорректная дата');
  }

  const stmt = db!.prepare('INSERT INTO deposits (amount, date, note) VALUES (?, ?, ?)');
  const result = stmt.run(amount, deposit.date, note);
  return { id: result.lastInsertRowid, amount, date: deposit.date, note };
});

ipcMain.handle('db:deleteDeposit', (_, id: number) => {
  db!.prepare('DELETE FROM deposits WHERE id = ?').run(id);
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

  let startAmount: number;
  let baseCheckpoint: { amount: number; date: string | null };
  let expenses: Array<{ amount: number; category_name: string; subcategory_name?: string; date: string }>;
  let deposits: Array<{ amount: number; date: string; note: string }>;

  if (cpInPeriod) {
    startAmount = cpInPeriod.amount;
    baseCheckpoint = { amount: cpInPeriod.amount, date: cpInPeriod.d };
    expenses = db!.prepare(
      `SELECT e.*, c.name as category_name, s.name as subcategory_name
       FROM expenses e
       JOIN categories c ON e.category_id = c.id
       LEFT JOIN subcategories s ON e.subcategory_id = s.id
       WHERE ${AFTER_CP}
       ORDER BY date(e.date) DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof expenses;
    deposits = db!.prepare(
      `SELECT * FROM deposits WHERE ${AFTER_CP}
       ORDER BY date(date) DESC, created_at DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof deposits;
  } else {
    const start = getDerivedBalanceAt(startDate);
    startAmount = start.balance;
    baseCheckpoint = { amount: start.base, date: start.baseDate };
    expenses = db!.prepare(
      `SELECT e.*, c.name as category_name, s.name as subcategory_name
       FROM expenses e
       JOIN categories c ON e.category_id = c.id
       LEFT JOIN subcategories s ON e.subcategory_id = s.id
       WHERE date(e.date) BETWEEN date(?) AND date(?)
       ORDER BY date(e.date) DESC`
    ).all(startDate, endDate) as typeof expenses;
    deposits = db!.prepare(
      `SELECT * FROM deposits
       WHERE date(date) BETWEEN date(?) AND date(?)
       ORDER BY date(date) DESC, created_at DESC`
    ).all(startDate, endDate) as typeof deposits;
  }

  // Остаток на конец периода — производный, включает все операции периода
  const end = getDerivedBalanceAt(endDate);

  const totalExpenses = expenses.reduce((sum, e) => sum + e.amount, 0);
  const totalDeposits = deposits.reduce((sum, d) => sum + d.amount, 0);

  const byCategory = expenses.reduce((acc, e) => {
    const key = e.category_name;
    if (!acc[key]) acc[key] = { total: 0, subcategories: {} };
    acc[key].total += e.amount;
    if (e.subcategory_name) {
      if (!acc[key].subcategories[e.subcategory_name]) acc[key].subcategories[e.subcategory_name] = 0;
      acc[key].subcategories[e.subcategory_name] += e.amount;
    }
    return acc;
  }, {} as Record<string, { total: number; subcategories: Record<string, number> }>);

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
    period: { startDate, endDate },
  };
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
