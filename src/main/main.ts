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
  /** Кредиты за период — отдельной строкой, иначе суммы не сойдутся */
  loanTaken: number;
  loanRepaid: number;
  /** Удержание агрегаторов за период: не трата, но сумму съедает */
  withheldByAggregators: number;
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

/**
 * Проверяет, что такого названия ещё нет — без учёта регистра.
 *
 * SQLite здесь не годится: better-sqlite3 собран без ICU, поэтому NOCASE и
 * lower() считают «зарплата» и «Зарплата» разными строками, и UNIQUE на name
 * такие дубли пропускает. Поэтому имена запрашиваются и сверяются в JS —
 * так же, как это делает db:addDepositCategory.
 *
 * selectSql уже отфильтровал всё, что можно переименовывать: у подкатегорий и
 * статей уникальность проверяется только внутри родителя.
 */
function assertUniqueName(selectSql: string, params: unknown[], name: string): void {
  const rows = db!.prepare(selectSql).all(...params) as { name: string }[];
  const target = name.trim().toLowerCase();
  if (rows.some((r) => (r.name || '').trim().toLowerCase() === target)) {
    throw new Error(`«${name}» уже есть`);
  }
}

function cleanRenameName(name: string): string {
  const clean = (name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Название не может быть пустым');
  if (clean.length > 100) throw new Error('Название слишком длинное');
  return clean;
}

// ——— Переименование ———
// Траты, подкатегории и статьи ссылаются на справочники по id, поэтому смена
// названия ничего не ломает: суммы, даты и разбивка по отчётам сохраняются.
ipcMain.handle('db:renameCategory', (_, id: number, name: string) => {
  const clean = cleanRenameName(name);
  const row = db!.prepare('SELECT name, is_custom FROM categories WHERE id = ?').get(id) as
    | { name: string; is_custom: number }
    | undefined;
  if (!row) throw new Error('Категория не найдена');
  if (row.name === clean) return { success: true, name: clean };

  assertUniqueName('SELECT name FROM categories WHERE id <> ?', [id], clean);

  const run = db!.transaction(() => {
    // Переименованную встроенную категорию нельзя создавать заново: после
    // перезапуска applySchema() вернула бы её под старым именем.
    if (row.is_custom === 0) {
      db!.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
      ).run(`renamed_default:${row.name}`);
    }
    db!.prepare('UPDATE categories SET name = ? WHERE id = ?').run(clean, id);
  });
  run();
  return { success: true, name: clean };
});

ipcMain.handle('db:renameSubcategory', (_, id: number, name: string) => {
  const clean = cleanRenameName(name);
  const row = db!.prepare(
    `SELECT s.name, s.is_custom, s.category_id, c.is_custom AS cat_is_custom
     FROM subcategories s JOIN categories c ON c.id = s.category_id
     WHERE s.id = ?`
  ).get(id) as
    | { name: string; is_custom: number; category_id: number; cat_is_custom: number }
    | undefined;
  if (!row) throw new Error('Подкатегория не найдена');
  if (row.name === clean) return { success: true, name: clean };

  assertUniqueName(
    'SELECT name FROM subcategories WHERE category_id = ? AND id <> ?',
    [row.category_id, id],
    clean
  );

  const run = db!.transaction(() => {
    // Встроенная подкатегория встроенной категории тоже не должна вернуться.
    // Ключ хранит id родителя, иначе переименование категории его обесценит.
    if (row.is_custom === 0 || row.cat_is_custom === 0) {
      db!.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
      ).run(`renamed_sub:${row.category_id}:${row.name}`);
    }
    db!.prepare('UPDATE subcategories SET name = ? WHERE id = ?').run(clean, id);
  });
  run();
  return { success: true, name: clean };
});

ipcMain.handle('db:renameSubitem', (_, id: number, name: string) => {
  const clean = cleanRenameName(name);
  const row = db!.prepare('SELECT name, subcategory_id FROM subitems WHERE id = ?').get(id) as
    | { name: string; subcategory_id: number }
    | undefined;
  if (!row) throw new Error('Статья не найдена');
  if (row.name === clean) return { success: true, name: clean };

  assertUniqueName(
    'SELECT name FROM subitems WHERE subcategory_id = ? AND id <> ?',
    [row.subcategory_id, id],
    clean
  );
  db!.prepare('UPDATE subitems SET name = ? WHERE id = ?').run(clean, id);
  return { success: true, name: clean };
});

ipcMain.handle('db:renameDepositCategory', (_, id: number, name: string) => {
  const clean = cleanRenameName(name);
  const row = db!.prepare('SELECT name FROM deposit_categories WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
  if (!row) throw new Error('Категория внесений не найдена');
  if (row.name === clean) return { success: true, name: clean };

  assertUniqueName('SELECT name FROM deposit_categories WHERE id <> ?', [id], clean);
  db!.prepare('UPDATE deposit_categories SET name = ? WHERE id = ?').run(clean, id);
  return { success: true, name: clean };
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
    // Статья — только метка: снимаем ссылку, трату не трогаем
    db!.prepare('UPDATE expenses SET subitem_id = NULL WHERE subitem_id = ?').run(itemId);
    db!.prepare('UPDATE recurring SET subitem_id = NULL WHERE subitem_id = ?').run(itemId);
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
      // Регулярные платежи этой категории удалятся вместе с ней: поле
      // category_id у них NOT NULL, и подставить вместо него нечего.
      const recurring = db!.prepare(
        'SELECT COUNT(*) c FROM recurring WHERE category_id = ?'
      ).get(id) as { c: number };
      return {
        expenses: expenses.c,
        subcategories: subs.c,
        subitems: items.c,
        recurring: recurring.c,
      };
    }
    if (kind === 'subitem') {
      const expenses = db!.prepare('SELECT COUNT(*) c FROM expenses WHERE subitem_id = ?').get(id) as {
        c: number;
      };
      return { expenses: expenses.c, subcategories: 0, subitems: 0, recurring: 0 };
    }
    const expenses = db!.prepare(
      `SELECT COUNT(*) c FROM expenses
       WHERE subcategory_id = ?
          OR subitem_id IN (SELECT id FROM subitems WHERE subcategory_id = ?)`
    ).get(id, id) as { c: number };
    const items = db!.prepare('SELECT COUNT(*) c FROM subitems WHERE subcategory_id = ?').get(id) as {
      c: number;
    };
    return { expenses: expenses.c, subcategories: 0, subitems: items.c, recurring: 0 };
  }
);

/**
 * Объединение нескольких категорий в одну.
 *
 * Выбранная основная категория сохраняется, остальные исчезают из справочника.
 * Переносим всё содержимое: подкатегории со статьями, траты и регулярные
 * платежи. Траты, у которых подкатегории не было, просто меняют category_id
 * и остаются на верхнем уровне основной категории.
 *
 * Имена подкатегорий могут совпасть — тогда они сливаются в одну, а траты с
 * обеих сторон начинают разделяться по ней. Удалять дубли нельзя: на одном из
 * них может висеть статья, а потеря статьи — это потеря детализации.
 */
ipcMain.handle('db:mergeCategories', (_, payload: { targetId: number; sourceIds: number[] }) => {
  const targetId = Number(payload.targetId);
  const sourceIds = (payload.sourceIds || []).map(Number).filter((id) => id > 0 && id !== targetId);
  if (!Number.isFinite(targetId) || targetId <= 0) throw new Error('Не выбрана основная категория');
  if (sourceIds.length === 0) throw new Error('Не выбрано, что объединять');

  const target = db!.prepare('SELECT name, is_custom FROM categories WHERE id = ?').get(targetId) as
    | { name: string; is_custom: number }
    | undefined;
  if (!target) throw new Error('Основная категория не найдена');

  const stats = { movedSubcategories: 0, mergedSubcategories: 0, movedExpenses: 0, movedRecurring: 0 };

  const run = db!.transaction(() => {
    for (const srcId of sourceIds) {
      const src = db!.prepare('SELECT name, is_custom FROM categories WHERE id = ?').get(srcId) as
        | { name: string; is_custom: number }
        | undefined;
      if (!src) continue;

      // 1. Подкатегории: переносим в основную, при совпадении имён сливаем.
      const subs = db!
        .prepare('SELECT id, name FROM subcategories WHERE category_id = ?')
        .all(srcId) as { id: number; name: string }[];
      for (const sub of subs) {
        const clash = db!
          .prepare(
            `SELECT id FROM subcategories
             WHERE category_id = ? AND name = ? AND id <> ?`
          )
          .get(targetId, sub.name, sub.id) as { id: number } | undefined;
        if (clash) {
          // Статьи переносятся в существующую подкатегорию с тем же именем
          db!.prepare('UPDATE subitems SET subcategory_id = ? WHERE subcategory_id = ?').run(
            clash.id,
            sub.id
          );
          db!.prepare('UPDATE expenses SET subcategory_id = ? WHERE subcategory_id = ?').run(
            clash.id,
            sub.id
          );
          db!.prepare('DELETE FROM subcategories WHERE id = ?').run(sub.id);
          stats.mergedSubcategories++;
        } else {
          db!.prepare('UPDATE subcategories SET category_id = ? WHERE id = ?').run(targetId, sub.id);
          stats.movedSubcategories++;
        }
      }

      // 2. Траты: переносим ВСЕ, а не только те, у которых подкатегории нет.
      //    Раньше здесь стояло `AND subcategory_id IS NULL`, и траты с
      //    подкатегорией оставались со старой категорией — удаление исчезающей
      //    категории падало на внешнем ключе. Подкатегория к этому моменту уже
      //    переехала в основную, поэтому трата меняет верхний уровень, а
      //    детализация сохраняется.
      const moved = db!.prepare('UPDATE expenses SET category_id = ? WHERE category_id = ?').run(
        targetId,
        srcId
      );
      stats.movedExpenses += moved.changes;

      // 3. Регулярные платежи: переносим целиком — иначе удаление категории
      //    тоже упёрлось бы во внешний ключ.
      const rec = db!.prepare('UPDATE recurring SET category_id = ? WHERE category_id = ?').run(
        targetId,
        srcId
      );
      stats.movedRecurring += rec.changes;

      // Ссылка на подкатегорию могла остаться на слитой (уже удалённой).
      // Подчищаем: осиротевшая ссылка скрыла бы трату из списков, но
      // продолжала бы влиять на остаток.
      db!.prepare(
        `UPDATE expenses SET subcategory_id = NULL, subitem_id = NULL
         WHERE subcategory_id IS NOT NULL
           AND subcategory_id NOT IN (SELECT id FROM subcategories)`
      ).run();

      // 4. Встроенную исчезающую категорию запоминаем, иначе applySchema()
      //    вернёт её при следующем запуске.
      if (src.is_custom === 0) {
        db!.prepare(
          `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
        ).run(`deleted_default:${src.name}`);
      }
      db!.prepare('DELETE FROM categories WHERE id = ?').run(srcId);
    }
  });
  run();

  // Синхронизируем настройки переименованных встроенных подкатегорий: после
  // переноса ключ deleted_sub ссылается на старую категорию и перестаёт
  // защищать подкатегорию от возврата.
  return { success: true, ...stats, targetName: target.name };
});

/**
 * Удаление категории. Разрешено и для встроенных («Закуп», «Такси») —
 * ограничения на is_custom больше нет.
 *
 * С 1.0.22 траты НЕ удаляются: у них просто снимается ссылка на категорию,
 * и они остаются в базе под ключом «Без категории». Раньше здесь стояло
 * каскадное удаление, но оно молча уносило историю трат — а потерять историю
 * из-за того, что переименовываешь или убираешь ненужную категорию, нельзя.
 * Подкатегории и статьи как справочник удаляются: иначе они осиротеют.
 */
ipcMain.handle('db:deleteCategory', (_, id: number) => {
  const row = db!.prepare('SELECT name, is_custom FROM categories WHERE id = ?').get(id) as
    | { name: string; is_custom: number }
    | undefined;
  if (!row) throw new Error('Категория не найдена');

  let deletedRecurring = 0;
  const run = db!.transaction((categoryId: number, name: string, isCustom: number) => {
    // Встроенную категорию запоминаем как удалённую, иначе applySchema()
    // создаст её заново при следующем запуске.
    if (isCustom === 0) {
      db!.prepare(
        `INSERT OR REPLACE INTO settings (key, value) VALUES (?, datetime('now'))`
      ).run(`deleted_default:${name}`);
    }
    // Траты сохраняем: снимаем все три ссылки, они указывали на справочник,
    // который сейчас исчезнет.
    db!.prepare('UPDATE expenses SET category_id = NULL WHERE category_id = ?').run(categoryId);
    db!.prepare(
      `UPDATE expenses SET subcategory_id = NULL, subitem_id = NULL
       WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)
          OR subitem_id IN (
            SELECT si.id FROM subitems si
            JOIN subcategories s ON s.id = si.subcategory_id
            WHERE s.category_id = ?
          )`
    ).run(categoryId, categoryId);
    db!.prepare(
      `DELETE FROM subitems WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)`
    ).run(categoryId);
    // Регулярные платежи привязаны к справочнику, поэтому их ссылки тоже надо
    // снять ДО удаления: иначе удаление подкатегории каскадит в статьи, а
    // платёж продолжает ссылаться на несуществующие строки и SQLite отказывает
    // по внешнему ключу.
    db!.prepare(
      `UPDATE recurring SET subcategory_id = NULL, subitem_id = NULL
       WHERE subcategory_id IN (SELECT id FROM subcategories WHERE category_id = ?)
          OR subitem_id IN (
            SELECT si.id FROM subitems si
            JOIN subcategories s ON s.id = si.subcategory_id
            WHERE s.category_id = ?
          )`
    ).run(categoryId, categoryId);
    // А вот у самого recurring.category_id стоит NOT NULL, и подставить ему
    // нечего: платёж без категории создал бы трату в пустоту. Поэтому такие
    // платежи удаляются вместе с категорией — их число показывается в
    // подтверждении, чтобы исчезновение не было сюрпризом.
    const recurringGone = db!.prepare(
      'DELETE FROM recurring WHERE category_id = ?'
    ).run(categoryId);
    deletedRecurring = recurringGone.changes;
    db!.prepare('DELETE FROM subcategories WHERE category_id = ?').run(categoryId);
    db!.prepare('DELETE FROM categories WHERE id = ?').run(categoryId);
  });

  run(id, row.name, row.is_custom);
  return { success: true, deletedRecurring };
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
    // Траты остаются: теряется привязка к статье и подкатегории, но не сама трата
    db!.prepare(
      `UPDATE expenses SET subcategory_id = NULL, subitem_id = NULL
       WHERE subcategory_id = ?
          OR subitem_id IN (SELECT id FROM subitems WHERE subcategory_id = ?)`
    ).run(subId, subId);
    // Регулярные платежи переживают удаление подкатегории: теряют привязку,
    // но напоминание остаётся. Категория у них своя, целая.
    db!.prepare(
      `UPDATE recurring SET subcategory_id = NULL, subitem_id = NULL
       WHERE subcategory_id = ?
          OR subitem_id IN (SELECT id FROM subitems WHERE subcategory_id = ?)`
    ).run(subId, subId);
    db!.prepare('DELETE FROM subitems WHERE subcategory_id = ?').run(subId);
    db!.prepare('DELETE FROM subcategories WHERE id = ?').run(subId);
  });
  run(id);
  return { success: true };
});

ipcMain.handle(
  'db:getExpenses',
  (
    _,
    {
      startDate,
      endDate,
      accountId,
    }: {
      startDate: string;
      endDate: string;
      /** null — все счета */
      accountId?: number | null;
    }
  ) => {
    // LEFT JOIN, а не JOIN: у траты может не быть категории (удалённую категорию
    // мы теперь сохраняем), и при INNER JOIN она молча исчезла бы из таблицы,
    // продолжая при этом влиять на остаток.
    const byAccount = accountId != null && accountId > 0;
    return db!.prepare(
      `SELECT e.*, c.name as category_name, c.icon as category_icon, c.color as category_color,
              s.name as subcategory_name, si.name as subitem_name
       FROM expenses e
       LEFT JOIN categories c ON e.category_id = c.id
       LEFT JOIN subcategories s ON e.subcategory_id = s.id
       LEFT JOIN subitems si ON e.subitem_id = si.id
       WHERE date(e.date) BETWEEN date(?) AND date(?)
         ${byAccount ? 'AND e.account_id = ?' : ''}
       ORDER BY date(e.date) DESC, e.created_at DESC`
    ).all(...(byAccount ? [startDate, endDate, accountId] : [startDate, endDate]));
  }
);

ipcMain.handle('db:addExpense', (_, expense: { categoryId: number; subcategoryId?: number; subitemId?: number; amount: number; date: string; note?: string; accountId?: number }) => {
  const accountId = resolveAccount(expense.accountId);
  const stmt = db!.prepare(
    'INSERT INTO expenses (category_id, subcategory_id, subitem_id, amount, date, note, account_id) VALUES (?, ?, ?, ?, ?, ?, ?)'
  );
  const result = stmt.run(
    expense.categoryId,
    expense.subcategoryId || null,
    expense.subitemId || null,
    expense.amount,
    expense.date,
    expense.note || null,
    accountId
  );
  return { id: result.lastInsertRowid, ...expense, warning: checkBackdated(expense.date) };
});

/**
 * Приводит переданный счёт к существующему id.
 *
 * Формы иногда присылают пустое или протухшее значение (счёт удалили, пока был
 * открыт диалог). Тогда берём счёт по умолчанию — запись не должна теряться
 * из-за того, что счёт исчез из-под формы.
 */
function resolveAccount(accountId?: number | null): number {
  const id = Number(accountId);
  if (Number.isFinite(id) && id > 0) {
    const exists = db!.prepare('SELECT id FROM accounts WHERE id = ?').get(id);
    if (exists) return id;
  }
  const fallback = db!.prepare('SELECT id FROM accounts WHERE is_default = 1').get() as
    | { id: number }
    | undefined;
  if (!fallback) throw new Error('Нет ни одного счёта — создайте счёт в боковой панели');
  return fallback.id;
}

/**
 * Последняя отметка «Указать остаток» не позже указанной даты.
 *
 * Всё, что записано раньше этой отметки, в остаток не попадает: её сумма уже
 * включает те операции. Обычно это неудобно, а не опасно, поэтому запись всё
 * равно создаётся — просто интерфейсу сказать, почему остаток не изменился.
 */
function checkBackdated(dateStr: string): string | null {
  const cp = db!.prepare(
    `SELECT date(date) AS d FROM balance_history
     ORDER BY date(date) DESC, created_at DESC LIMIT 1`
  ).get() as { d: string } | undefined;
  if (!cp) return null;
  if (dateStr >= cp.d) return null;
  return `Остаток указан на ${cp.d}, поэтому эта запись от ${dateStr} в него не вошла. Измените дату отметки остатка, если хотите её учесть.`;
}

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
  account_id?: number | null;
}

/** Внесение целиком — нужно для возврата удалённой записи */
interface RestorableDeposit {
  id: number;
  amount: number;
  date: string;
  category_id: number | null;
  note: string | null;
  created_at: string;
  account_id?: number | null;
}

/**
 * Возврат удалённой траты для отмены удаления.
 *
 * Запись вставляется с тем же id, что была до удаления, иначе в таблице
 * появился бы дубль при следующем добавлении: AUTOINCREMENT продолжает
 * счёт от максимального id, а не от того, который занимала удалённая строка.
 */
ipcMain.handle('db:restoreExpense', (_, expense: RestorableExpense) => {
  // Категорию могли удалить, пока висел тост с отменой. Траты показываются
  // INNER JOIN'ом по категории, поэтому запись с битой ссылкой исчезла бы из
  // таблицы и отчёта, но продолжала бы уменьшать остаток — деньги пропали бы
  // из поля зрения вместе со своим объяснением. Поэтому подставляем любую
  // существующую категорию трат, а если их нет вовсе — отказываем.
  let categoryId = Number(expense.category_id);
  const stillThere = db!.prepare('SELECT id FROM categories WHERE id = ?').get(categoryId);
  if (!stillThere) {
    const fallback = db!.prepare(
      "SELECT id FROM categories WHERE type = 'expense' ORDER BY sort_order, id LIMIT 1"
    ).get() as { id: number } | undefined;
    if (!fallback) {
      throw new Error('Категория траты удалена — вернуть запись некуда. Создайте категорию.');
    }
    categoryId = fallback.id;
  }

  // Счёт восстанавливаем обязательно: остаток считается по счетам, и запись
  // без счёта в него не попала бы. Отмена удаления молча уводила бы трату из
  // суммы, пока деньги висели бы в таблице.
  const accountId = resolveAccount(expense.account_id);

  db!.prepare(
    `INSERT INTO expenses (id, category_id, subcategory_id, subitem_id, amount, date, note, created_at, account_id)
     VALUES (@id, @category_id, @subcategory_id, @subitem_id, @amount, @date, @note, @created_at, @account_id)`
  ).run({
    id: expense.id,
    category_id: categoryId,
    // Подкатегория и статья могли исчезнуть вместе со своей категорией —
    // тогда оставляем трату на верхнем уровне, это честнее битой ссылки.
    subcategory_id: categoryId === expense.category_id ? (expense.subcategory_id ?? null) : null,
    subitem_id: categoryId === expense.category_id ? (expense.subitem_id ?? null) : null,
    amount: expense.amount,
    date: expense.date,
    note: expense.note ?? null,
    created_at: expense.created_at,
    account_id: accountId,
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
  const accounts = db!.prepare('SELECT id FROM accounts ORDER BY id').all() as { id: number }[];

  // Считаем по каждому счёту отдельно и складываем. Отметка «Указать остаток»
  // принадлежит счёту, а не всей базе: отметка от 1-го на «Карте» не должна
  // обнулять внесение от 5-го на «Наличных». Общая отметка на все счета —
  // это разные деньги, смешанные в одну сумму, и такой расчёт их терял.
  const cpStmt = db!.prepare(`
    SELECT amount, date(date) AS d, created_at AS ca
    FROM balance_history
    WHERE account_id = ? AND date(date) <= date(?)
    ORDER BY date(date) DESC, created_at DESC
    LIMIT 1
  `);
  const depStmt = db!.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s FROM deposits
    WHERE account_id = ?
      AND (date(date) > ? OR (date(date) = ? AND created_at > ?))
      AND date(date) <= date(?)
  `);
  const expStmt = db!.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS s FROM expenses
    WHERE account_id = ?
      AND (date(date) > ? OR (date(date) = ? AND created_at > ?))
      AND date(date) <= date(?)
  `);

  let balance = 0;
  let base = 0;
  let baseDate: string | null = null;

  for (const acc of accounts) {
    const cp = cpStmt.get(acc.id, dateStr) as
      | { amount: number; d: string; ca: string }
      | undefined;
    const cpDate = cp?.d ?? '0000-01-01';
    const cpCreated = cp?.ca ?? '';

    const dep = depStmt.get(acc.id, cpDate, cpDate, cpCreated, dateStr) as { s: number };
    const exp = expStmt.get(acc.id, cpDate, cpDate, cpCreated, dateStr) as { s: number };

    balance += (cp?.amount ?? 0) + dep.s - exp.s;
    base += cp?.amount ?? 0;
    // Для подсказки под остатком показываем самую свежую отметку из всех
    if (cp && (baseDate === null || cp.d > baseDate)) baseDate = cp.d;
  }

  return { balance, base, baseDate };
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

ipcMain.handle('db:addBalance', (_, balance: { amount: number; date: string; note?: string; accountId?: number }) => {
  const stmt = db!.prepare(
    'INSERT INTO balance_history (amount, date, note, account_id) VALUES (?, ?, ?, ?)'
  );
  const result = stmt.run(
    balance.amount,
    balance.date,
    balance.note || null,
    resolveAccount(balance.accountId)
  );
  return { id: result.lastInsertRowid, ...balance };
});

ipcMain.handle('db:deleteBalance', (_, id: number) => {
  db!.prepare('DELETE FROM balance_history WHERE id = ?').run(id);
  return { success: true };
});

// ——— Внесения денег ———
ipcMain.handle(
  'db:getDeposits',
  (
    _,
    {
      startDate,
      endDate,
      accountId,
    }: { startDate: string; endDate: string; accountId?: number | null }
  ) => {
    const byAccount = accountId != null && accountId > 0;
    return db!.prepare(
      `SELECT d.*, c.name as category_name
       FROM deposits d
       LEFT JOIN deposit_categories c ON d.category_id = c.id
       WHERE date(d.date) BETWEEN date(?) AND date(?)
         ${byAccount ? 'AND d.account_id = ?' : ''}
       ORDER BY date(d.date) DESC, d.created_at DESC`
    ).all(...(byAccount ? [startDate, endDate, accountId] : [startDate, endDate]));
  }
);

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
  const row = db!.prepare('SELECT name FROM deposit_categories WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
  if (!row) throw new Error('Категория внесений не найдена');

  const count = db!.prepare('SELECT COUNT(*) c FROM deposits WHERE category_id = ?').get(id) as {
    c: number;
  };

  // Внесения удаляются вместе с категорией — по симметрии с категориями трат.
  // Раньше здесь стояло обнуление category_id, и деньги оставались в базе без
  // категории: суммы в отчётах сохранялись, но вклад «Яндекс» из отчёта по
  // внесениям исчезал молча, а баланс менялся без видимой причины.
  const run = db!.transaction((catId: number) => {
    db!.prepare(`DELETE FROM deposits WHERE category_id = ?`).run(catId);
    db!.prepare(`DELETE FROM deposit_categories WHERE id = ?`).run(catId);
  });
  run(id);
  return { success: true, deletedDeposits: count.c };
});

ipcMain.handle('db:setDepositCategoryColor', (_, id: number, color: string | null) => {
  const clean = color && typeof color === 'string' ? color.trim() : null;
  db!.prepare(`UPDATE deposit_categories SET color = ? WHERE id = ?`).run(clean || null, id);
  return { success: true };
});

ipcMain.handle('db:addDeposit', (_, deposit: { amount: number; date: string; categoryId: number; accountId?: number }) => {
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
    `INSERT INTO deposits (amount, date, category_id, account_id) VALUES (?, ?, ?, ?)`
  );
  const result = stmt.run(amount, deposit.date, categoryId, resolveAccount(deposit.accountId));
  return {
    id: result.lastInsertRowid,
    amount,
    date: deposit.date,
    category_id: categoryId,
    category_name: category.name,
    warning: checkBackdated(deposit.date),
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
  // Категорию внесений могли удалить, пока висел тост с отменой. Внесения
  // допускают пустую категорию (поле NULL), поэтому просто обнуляем ссылку:
  // сумма, дата и порядок сохраняются, ничего не теряется.
  let categoryId: number | null = deposit.category_id ?? null;
  if (categoryId !== null) {
    const stillThere = db!.prepare('SELECT id FROM deposit_categories WHERE id = ?').get(categoryId);
    if (!stillThere) categoryId = null;
  }

  // Счёт тоже восстанавливаем: без него внесение не попало бы в остаток.
  const accountId = resolveAccount(deposit.account_id);

  db!.prepare(
    `INSERT INTO deposits (id, amount, date, category_id, note, created_at, account_id)
     VALUES (@id, @amount, @date, @category_id, @note, @created_at, @account_id)`
  ).run({
    id: deposit.id,
    amount: deposit.amount,
    date: deposit.date,
    category_id: categoryId,
    note: deposit.note ?? null,
    created_at: deposit.created_at,
    account_id: accountId,
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
    LEFT JOIN categories c ON e.category_id = c.id
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
         AND e.loan_id IS NULL
       ORDER BY date(e.date) DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof expenses;
    deposits = db!.prepare(
      `${DEPOSIT_SELECT} WHERE ${DEPOSIT_AFTER_CP}
         AND d.loan_id IS NULL
       ORDER BY date(d.date) DESC, d.created_at DESC`
    ).all(cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate) as typeof deposits;
  } else {
    const start = getDerivedBalanceAt(previousDayISO(startDate));
    startAmount = start.balance;
    baseCheckpoint = { amount: start.base, date: start.baseDate };
    expenses = db!.prepare(
      `${EXPENSE_SELECT}
       WHERE date(e.date) BETWEEN date(?) AND date(?)
         AND e.loan_id IS NULL
       ORDER BY date(e.date) DESC`
    ).all(startDate, endDate) as typeof expenses;
    deposits = db!.prepare(
      `${DEPOSIT_SELECT}
       WHERE date(d.date) BETWEEN date(?) AND date(?)
         AND d.loan_id IS NULL
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
    // Категории может не быть: её удалили, а трату сохранили. Собираем такие
    // под отдельным названием, иначе они выпали бы из отчёта совсем.
    const key = e.category_name || 'Без категории';
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

  // Движения по займам за период. Они убраны из totalDeposits и totalExpenses,
// потому что заёмные деньги — не доход и не расход, но остаток они меняют.
// Поэтому показываем их отдельными строками: с ними арифметика отчёта
// сходится, start + внесения + займы - траты - возвраты = end.
const loanFlowWhere = cpInPeriod
  ? `${AFTER_CP}`
  : `date(date) BETWEEN date(?) AND date(?)`;
const loanFlowParams = cpInPeriod
  ? [cpInPeriod.d, cpInPeriod.d, cpInPeriod.ca, endDate]
  : [startDate, endDate];

const loanIn = db!.prepare(
  `SELECT COALESCE(SUM(amount), 0) AS s FROM deposits
   WHERE loan_id IS NOT NULL AND ${loanFlowWhere}`
).get(...loanFlowParams) as { s: number };

const loanOut = db!.prepare(
  `SELECT COALESCE(SUM(amount), 0) AS s FROM expenses
   WHERE loan_id IS NOT NULL AND ${loanFlowWhere}`
).get(...loanFlowParams) as { s: number };

// Сколько удержали агрегаторы за период. Считается по внесениям, где удержание
// зафиксировано, а не по настройкам выплат: процент там один, а суммы в
// разные недели разные.
const withheld = db!.prepare(
  `SELECT COALESCE(SUM(commission_amount), 0) AS s FROM deposits
   WHERE commission_amount IS NOT NULL AND ${loanFlowWhere}`
).get(...loanFlowParams) as { s: number };

const loanRows = db!.prepare(
  `${LOAN_SELECT} ORDER BY l.date_due, l.id`
).all() as LoanRow[];
const loans = withRemaining(loanRows);
// В отчёте интересуют только займы, которые попали в период или ещё не закрыты
const reportLoans = loans.filter(
  (l) => l.remaining > 0.001 || l.date_taken >= startDate || l.taken > 0
);
const openLoanDebt = loans.reduce((sum, l) => sum + l.remaining, 0);

  return {
    startBalance: startAmount,
    // Деньги на выходе: после всех внесений и вычетов
    endBalance: end.balance,
    totalExpenses,
    totalDeposits,
    // Движения по займам — отдельно от доходов и расходов
    loanTaken: loanIn.s,
    loanRepaid: loanOut.s,
    // Разница за период. Это и есть то самое слагаемое, которого не хватает
    // в «начало + внесения − траты»: деньги займа приходят и уходят, меняя
    // остаток, но не будучи ни доходом, ни расходом.
    loanNet: Math.round((loanIn.s - loanOut.s) * 100) / 100,
    openLoanDebt,
    // Удержание агрегаторов за период — отдельной строкой, не расходом
    withheldByAggregators: withheld.s,
    loans: reportLoans,
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
  type XlsxCell =
    | string
    | number
    | { value: string | number; bold?: boolean; fill?: string; numFmt?: string }
    | null;
type XlsxRow = XlsxCell[];

  // ——— Лист «Отчёт» ———
  const rows: XlsxRow[] = [
    [{ value: payload.title || 'Отчёт', bold: true }],
    [{ value: `Период: ${payload.period}`, bold: false }],
    [],
    [{ value: 'Показатель', bold: true }, { value: 'Сумма, ₸', bold: true }],
    [{ value: 'Начало (база)', bold: true }, { value: isNum(payload.startBalance), numFmt: MONEY }],
    [{ value: 'Внесения за период', bold: true }, { value: isNum(payload.totalDeposits), numFmt: MONEY }],
    [{ value: 'Траты за период', bold: true }, { value: isNum(payload.totalExpenses), numFmt: MONEY }],
  ];

  // Кредиты и удержание агрегаторов — между тратами и итогом. Без них строки
  // выше не складываются в «На выходе»: заём двигает остаток, не будучи ни
  // доходом, ни расходом, а удержание съедает часть внесения. Пишем только
  // когда они есть, иначе в уравнении файла будет лишний ноль.
  const loanTaken = isNum(payload.loanTaken);
  const loanRepaid = isNum(payload.loanRepaid);
  if (loanTaken || loanRepaid) {
    rows.push(
      [
        { value: 'Кредиты за период (взято − возвращено)', bold: true },
        { value: loanTaken - loanRepaid, numFmt: MONEY },
      ],
      // Расшифровка под суммой: само число «взято − возвращено» мало о чём
      // говорит, когда смотришь файл, а не экран
      [null, { value: `взято ${loanTaken} · возврат ${loanRepaid}` }]
    );
  }

  const withheldAgg = isNum(payload.withheldByAggregators);
  if (withheldAgg) {
    rows.push([
      { value: 'Удержано агрегаторами (из внесений, не трата)' },
      { value: withheldAgg, numFmt: MONEY },
    ]);
  }

  rows.push([
    { value: 'На выходе', bold: true },
    { value: isNum(payload.endBalance), numFmt: MONEY, fill: '#00d4aa' },
  ]);

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

/** Строка регулярного платежа в том виде, в каком её отдаёт база */
interface RecurringRow {
  id: number;
  title: string;
  category_id: number;
  subcategory_id: number | null;
  subitem_id: number | null;
  amount: number;
  frequency: RecurringFrequency;
  is_active: number;
  category_name: string;
  category_icon?: string | null;
  category_color?: string | null;
  subcategory_name: string | null;
}

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
 * Дата за день до указанной.
 *
 * Нужна, чтобы получить остаток на НАЧАЛО периода. getDerivedBalanceAt включает
 * все операции своей даты, поэтому для периода «День» она возвращала бы сумму
 * уже вместе с сегодняшними операциями: и база отчёта, и его строки считали бы
 * их дважды, и «Начало» совпадало бы с «На выходе». Заглядывая наканунне,
 * получаем честное «сколько было до начала периода».
 */
function previousDayISO(iso: string): string {
  const { y, m, d } = parseISODate(iso);
  const dt = new Date(y, m - 1, d - 1);
  const mm = String(dt.getMonth() + 1).padStart(2, '0');
  const dd = String(dt.getDate()).padStart(2, '0');
  return `${dt.getFullYear()}-${mm}-${dd}`;
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

/**
 * Даты всех платежей, попадающих в указанный месяц.
 *
 * Считается на сервере той же функцией advanceRecurringDate, что двигает
 * платёж по кнопке «оплачено». Это принципиально: если бы календарь считал
 * даты по-своему, он мог бы показать 28-е, а трата потом создалась бы с
 * другой датой — и визуально расходились бы два экрана об одном и том же.
 *
 * Ход начинается с next_date платежа, а не с начала месяца: так учитываются
 * просроченные и уже сдвинутые расписания.
 */
ipcMain.handle(
  'db:getRecurringCalendar',
  (_, range: { startDate: string; endDate: string }) => {
    const rows = db!.prepare(
      `${RECURRING_SELECT} WHERE r.is_active = 1`
    ).all() as (RecurringRow & { next_date: string; frequency: RecurringFrequency })[];

    const result: { date: string; title: string; amount: number; category_name: string; category_color: string | null }[] = [];

    for (const row of rows) {
      // Потолок нужен на случай, если платёж отстал на годы: ежедневный
      // за десять лет дал бы больше трёх с половиной тысяч шагов
      let cursor = row.next_date;
      for (let i = 0; i < 2000; i++) {
        if (cursor > range.endDate) break;
        if (cursor >= range.startDate) {
          result.push({
            date: cursor,
            title: row.title,
            amount: row.amount,
            category_name: row.category_name,
            category_color: row.category_color ?? null,
          });
        }
        const next = advanceRecurringDate(cursor, row.frequency);
        // Защита от зацикливания на некорректном периоде
        if (next <= cursor) break;
        cursor = next;
      }
    }

    return result.sort((a, b) => (a.date === b.date ? a.title.localeCompare(b.title) : a.date.localeCompare(b.date)));
  }
);

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
ipcMain.handle('db:payRecurring', (_, id: number, accountId?: number) => {
  const today = todayISO();
  const row = db!.prepare('SELECT * FROM recurring WHERE id = ?').get(id) as
    | (RecurringRow & { next_date: string })
    | undefined;

  if (!row) return { success: false, message: 'Платёж не найден' };

  // Тратой становится дата наступления, а не сегодня: если аренда была
  // должна прийти 1-го, а отмечена 3-го, в статистике она должна лежать
  // в том месяце, который оплачивали.
  const expenseDate = row.next_date < today ? row.next_date : today;
  const nextDate = advanceUntilFuture(row.next_date, row.frequency, today);

  const pay = db!.transaction(() => {
    db!.prepare(
      `INSERT INTO expenses (category_id, subcategory_id, subitem_id, amount, date, note, account_id)
       VALUES (?, ?, ?, ?, ?, ?, ?)`
    ).run(
      row.category_id,
      row.subcategory_id,
      row.subitem_id,
      row.amount,
      expenseDate,
      row.title,
      // Регулярный платёж не хранит свой счёт: пока их был один, спрашивать
      // было не о чем. Берём тот, что выбран в боковой панели, иначе основной.
      // Трата без счёта не попала бы в остаток вовсе.
      resolveAccount(accountId)
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

// ——— Счета и перемещения ———

/**
 * Остаток по каждому счёту.
 *
 * Общий остаток не изменился: перевод уходит из одного счёта и приходит в
 * другой, в сумме ноль. Но покомпонентно каждый счёт меняется, и именно это
 * показывают карточки в боковой панели.
 *
 * Расчёт по счёту повторяет общий: от последней отметки остатка на этом счёте
 * плюс внесения, минус траты, плюс переводы в минус переводы из.
 */
ipcMain.handle('db:getAccountBalances', () => {
  const accounts = db!.prepare('SELECT * FROM accounts ORDER BY sort_order, id').all() as {
    id: number;
    name: string;
    kind: string;
    color: string | null;
    sort_order: number;
    is_default: number;
  }[];

  const today = todayISO();

  return accounts.map((a) => {
    const cp = db!.prepare(
      `SELECT amount, date(date) AS d, created_at AS ca
       FROM balance_history
       WHERE account_id = ? AND date(date) <= date(?)
       ORDER BY date(date) DESC, created_at DESC LIMIT 1`
    ).get(a.id, today) as { amount: number; d: string; ca: string } | undefined;

    const baseDate = cp?.d ?? '0000-01-01';
    const baseCreated = cp?.ca ?? '';

    const deposits = db!.prepare(
      `SELECT COALESCE(SUM(amount), 0) s FROM deposits
       WHERE account_id = ?
         AND (date(date) > ? OR (date(date) = ? AND created_at > ?))`
    ).get(a.id, baseDate, baseDate, baseCreated) as { s: number };

    const expenses = db!.prepare(
      `SELECT COALESCE(SUM(amount), 0) s FROM expenses
       WHERE account_id = ?
         AND (date(date) > ? OR (date(date) = ? AND created_at > ?))`
    ).get(a.id, baseDate, baseDate, baseCreated) as { s: number };

    const out = db!.prepare(
      `SELECT COALESCE(SUM(amount), 0) s FROM transfers
       WHERE from_account_id = ? AND date(date) > ?`
    ).get(a.id, baseDate) as { s: number };

    const incoming = db!.prepare(
      `SELECT COALESCE(SUM(amount), 0) s FROM transfers
       WHERE to_account_id = ? AND date(date) > ?`
    ).get(a.id, baseDate) as { s: number };

    return {
      ...a,
      balance: (cp?.amount ?? 0) + deposits.s - expenses.s - out.s + incoming.s,
      base: cp?.amount ?? 0,
      baseDate: cp?.d ?? null,
    };
  });
});

ipcMain.handle('db:addAccount', (_, p: { name: string; kind?: string; color?: string | null }) => {
  const clean = (p.name || '').trim().replace(/\s+/g, ' ');
  if (!clean) throw new Error('Название счёта не может быть пустым');
  const all = db!.prepare('SELECT id, name FROM accounts').all() as { id: number; name: string }[];
  if (all.some((a) => a.name.trim().toLowerCase() === clean.toLowerCase())) {
    throw new Error(`Счёт «${clean}» уже есть`);
  }
  const order = (
    db!.prepare('SELECT COALESCE(MAX(sort_order), 0) + 1 n FROM accounts').get() as { n: number }
  ).n;
  const res = db!.prepare(
    'INSERT INTO accounts (name, kind, color, sort_order) VALUES (?, ?, ?, ?)'
  ).run(clean, p.kind === 'cash' ? 'cash' : 'card', p.color || null, order);
  return { id: Number(res.lastInsertRowid), name: clean };
});

ipcMain.handle('db:renameAccount', (_, id: number, name: string) => {
  const clean = cleanRenameName(name);
  const row = db!.prepare('SELECT name FROM accounts WHERE id = ?').get(id) as
    | { name: string }
    | undefined;
  if (!row) throw new Error('Счёт не найден');
  if (row.name === clean) return { success: true };
  assertUniqueName('SELECT name FROM accounts WHERE id <> ?', [id], clean);
  db!.prepare('UPDATE accounts SET name = ? WHERE id = ?').run(clean, id);
  return { success: true };
});

ipcMain.handle('db:setAccountColor', (_, id: number, color: string | null) => {
  db!.prepare('UPDATE accounts SET color = ? WHERE id = ?').run(color || null, id);
  return { success: true };
});

/**
 * Удаление счёта.
 *
 * Историю не удаляем: операции и переводы переезжают на счёт по умолчанию.
 * Терять деньги из-за того, что счёт закрыли, нельзя — то же правило, что и
 * у категорий трат.
 */
ipcMain.handle('db:deleteAccount', (_, id: number) => {
  const row = db!.prepare('SELECT name, is_default FROM accounts WHERE id = ?').get(id) as
    | { name: string; is_default: number }
    | undefined;
  if (!row) throw new Error('Счёт не найден');
  if (row.is_default === 1) throw new Error('Счёт по умолчанию удалить нельзя');

  const fallback = db!.prepare('SELECT id FROM accounts WHERE is_default = 1').get() as
    | { id: number }
    | undefined;
  if (!fallback) throw new Error('Нет счёта, на который можно перенести операции');

  const run = db!.transaction(() => {
    // Переводы, которые после переноса стали бы «сам в себя», убираем ЗАРАНЕЕ,
    // до UPDATE'ов: SQLite проверяет CHECK построчно и на самом обновлении
    // отклонил бы строку раньше, чем доедет следующий DELETE. Такие переводы
    // и так пустые — деньги сходили туда и обратно.
    db!.prepare(
      `DELETE FROM transfers
       WHERE (from_account_id = ? AND to_account_id = ?)
          OR (to_account_id = ? AND from_account_id = ?)`
    ).run(id, fallback.id, id, fallback.id);

    db!.prepare('UPDATE expenses SET account_id = ? WHERE account_id = ?').run(fallback.id, id);
    db!.prepare('UPDATE deposits SET account_id = ? WHERE account_id = ?').run(fallback.id, id);
    db!.prepare('UPDATE balance_history SET account_id = ? WHERE account_id = ?').run(fallback.id, id);
    db!.prepare('UPDATE transfers SET from_account_id = ? WHERE from_account_id = ?').run(
      fallback.id,
      id
    );
    db!.prepare('UPDATE transfers SET to_account_id = ? WHERE to_account_id = ?').run(fallback.id, id);
    db!.prepare('DELETE FROM accounts WHERE id = ?').run(id);
  });
  run();
  return { success: true };
});

ipcMain.handle('db:getTransfers', (_, range: { startDate: string; endDate: string }) => {
  return db!.prepare(
    `SELECT t.*, f.name AS from_name, f.color AS from_color,
            t2.name AS to_name, t2.color AS to_color
     FROM transfers t
     JOIN accounts f ON f.id = t.from_account_id
     JOIN accounts t2 ON t2.id = t.to_account_id
     WHERE date(t.date) BETWEEN date(?) AND date(?)
     ORDER BY date(t.date) DESC, t.created_at DESC`
  ).all(range.startDate, range.endDate);
});

/**
 * Перевод между своими счетами.
 *
 * На общий остаток не влияет, поэтому и в totalDeposits/totalExpenses его не
 * включаем: иначе снятие наличных посчиталось бы расходом. Проверка
 * от_к_кому <> от_к_кому стоит ещё и в БД, чтобы счёт-сам-в-себя прошёл
 * мимо интерфейса не мог.
 */
ipcMain.handle(
  'db:addTransfer',
  (
    _,
    p: { fromAccountId: number; toAccountId: number; amount: number; date: string; note?: string }
  ) => {
    const from = Number(p.fromAccountId);
    const to = Number(p.toAccountId);
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Сумма перевода должна быть больше нуля');
    }
    if (from === to) throw new Error('Нельзя перевести деньги на тот же счёт');
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error('Некорректная дата');
    for (const [label, accId] of [
      ['откуда', from],
      ['куда', to],
    ] as const) {
      const acc = db!.prepare('SELECT id FROM accounts WHERE id = ?').get(accId);
      if (!acc) throw new Error(`Счёт (${label}) не найден`);
    }
    const res = db!.prepare(
      `INSERT INTO transfers (from_account_id, to_account_id, amount, date, note)
       VALUES (?, ?, ?, ?, ?)`
    ).run(from, to, amount, p.date, (p.note || '').trim() || null);
    return { id: Number(res.lastInsertRowid) };
  }
);

ipcMain.handle('db:deleteTransfer', (_, id: number) => {
  db!.prepare('DELETE FROM transfers WHERE id = ?').run(id);
  return { success: true };
});

/**
 * Движение денежных средств: всё, что не является ни доходом, ни расходом.
 *
 * Перевод между своими счетами, выплата агрегатора и заём — три разные истории,
 * объединённые тем, что ни одна из них не попала ни в «Внесения», ни в «Траты»
 * отчёта. Из этого, однако, НЕ следует, что остаток не меняется:
 *
 *  - перевод перекладывает деньги между своими счетами — общий итог тот же;
 *  - выплата агрегатора приходит чистой суммой, удержание уже учтено;
 *  - заём двигает остаток по-настоящему: деньги пришли и ушли, но это не
 *    доход и не расход, а чужие деньги, которые нужно вернуть.
 *
 * Поэтому effect у последних двух не ноль, и в интерфейсе он показан явно:
 * иначе фраза «не входит в траты» читалась бы как «остаток не меняется».
 *
 * Остаток долга сюда НЕ вносится: это состояние, а не операция. Оно и так
 * видно в карточке сверху, а в списке операций мешало бы считать движение.
 *
 * Собираем в JS, а не одним UNION: у четырёх источников разный набор полей, и
 * приводить их к общей таблице было бы больше кода, чем честная склейка.
 */
ipcMain.handle('db:getMoneyMovements', (_, range: { startDate: string; endDate: string }) => {
  const { startDate, endDate } = range;

  const transfers = db!.prepare(
    `SELECT t.id, t.date, t.amount, t.note,
            f.name AS from_name, f.color AS from_color,
            t2.name AS to_name, t2.color AS to_color
     FROM transfers t
     JOIN accounts f ON f.id = t.from_account_id
     JOIN accounts t2 ON t2.id = t.to_account_id
     WHERE date(t.date) BETWEEN date(?) AND date(?)
     ORDER BY date(t.date) DESC`
  ).all(startDate, endDate) as any[];

  // Выплаты агрегаторов: внесение чистое, удержание лежит рядом
  const payouts = db!.prepare(
    `SELECT d.id, d.date, d.amount, d.commission_amount, d.note,
            c.name AS category_name
     FROM deposits d
     LEFT JOIN deposit_categories c ON c.id = d.category_id
     WHERE d.commission_amount IS NOT NULL
       AND date(d.date) BETWEEN date(?) AND date(?)
     ORDER BY date(d.date) DESC`
  ).all(startDate, endDate) as any[];

  // Все займы целиком — только чтобы посчитать текущий долг. Период здесь
  // не применяется намеренно: долг не «за период», он есть сейчас.
  //
  // База долга — max(объявлено, поступило), а не только поступило. Займ,
  // созданный с опцией «не записывать приход», внесений не имеет вовсе: при
  // старой формуле его долг выходил нулём и он молча пропадал из долга.
  const loanRows = db!.prepare(
    `SELECT l.amount AS declared,
            COALESCE((SELECT SUM(amount) FROM deposits WHERE loan_id = l.id), 0) AS taken,
            COALESCE((SELECT SUM(amount) FROM expenses  WHERE loan_id = l.id), 0) AS repaid
     FROM loans l`
  ).all() as { declared: number; taken: number; repaid: number }[];

  const loansIn = db!.prepare(
    `SELECT d.id, d.date, d.amount, d.note, l.title AS loan_title, l.id AS loan_id
     FROM deposits d JOIN loans l ON l.id = d.loan_id
     WHERE d.loan_id IS NOT NULL AND date(d.date) BETWEEN date(?) AND date(?)
     ORDER BY date(d.date) DESC`
  ).all(startDate, endDate) as any[];

  const loansOut = db!.prepare(
    `SELECT e.id, e.date, e.amount, e.note, l.title AS loan_title, l.id AS loan_id
     FROM expenses e JOIN loans l ON l.id = e.loan_id
     WHERE e.loan_id IS NOT NULL AND date(e.date) BETWEEN date(?) AND date(?)
     ORDER BY date(e.date) DESC`
  ).all(startDate, endDate) as any[];

  type Movement = {
    key: string;
    kind: 'transfer' | 'payout' | 'loan_in' | 'loan_repay';
    /** Только у операций по займу: нужен, чтобы собрать их в группы */
    loanId?: number;
    date: string;
    title: string;
    amount: number;
    /** Влияние на общий остаток. Ноль у переводов и выплат, у займов — нет. */
    effect: number;
    detail: string;
    color: string | null;
    extra?: string | null;
    canDelete: boolean;
  };

  const movements: Movement[] = [];

  for (const t of transfers) {
    movements.push({
      key: `t${t.id}`,
      kind: 'transfer',
      date: t.date,
      title: t.note || `${t.from_name} → ${t.to_name}`,
      amount: t.amount,
      effect: 0,
      detail: `${t.from_name} → ${t.to_name}`,
      color: t.from_color,
      canDelete: true,
    });
  }

  for (const p of payouts) {
    movements.push({
      key: `p${p.id}`,
      kind: 'payout',
      date: p.date,
      title: p.note || p.category_name || 'Выплата агрегатора',
      amount: p.amount,
      effect: 0,
      detail: 'выплата агрегатора',
      color: null,
      // Ноль удержания — обычное дело (бонусная неделя, нулевой процент),
      // и писать «удержано 0» незачем. Сама выплата в списке остаётся: колонка
      // commission_amount заполнена и нулем тоже, именно этим она и помечена.
      extra: p.commission_amount > 0 ? `удержано ${p.commission_amount}` : null,
      canDelete: false,
    });
  }

  for (const l of loansIn) {
    movements.push({
      key: `li${l.id}`,
      kind: 'loan_in',
      loanId: l.loan_id,
      date: l.date,
      title: l.note || l.loan_title,
      amount: l.amount,
      effect: l.amount,
      detail: 'заём получен',
      color: null,
      extra: 'деньги чужие, их надо вернуть',
      canDelete: false,
    });
  }

  for (const l of loansOut) {
    movements.push({
      key: `lr${l.id}`,
      kind: 'loan_repay',
      loanId: l.loan_id,
      date: l.date,
      title: l.note || l.loan_title,
      amount: l.amount,
      effect: -l.amount,
      detail: 'возврат займа',
      color: null,
      canDelete: false,
    });
  }

  movements.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0));

  return {
    movements,
    // Удержание — за период, как всё остальное на этом экране
    withheld: payouts.reduce((s, p) => s + (p.commission_amount ?? 0), 0),
    // Движение кредитов — за период
    loanTaken: loansIn.reduce((s, l) => s + l.amount, 0),
    loanRepaid: loansOut.reduce((s, l) => s + l.amount, 0),
    // Долг, наоборот, всегда текущий: период тут ни при чём
    loanDebt: loanRows.reduce(
      (s, l) => s + Math.max(0, Math.max(l.taken, l.declared) - l.repaid),
      0
    ),
  };
});

// ——— Займы ———

/**
 * Остаток по займу берётся из связанных записей, а не из отдельного поля
 * «возвращено»: возврат — это обычная трата с пометкой loan_id, и отдельный
 * счётчик рано или поздно разошёлся бы с реальными записями.
 */
const LOAN_SELECT = `
  SELECT l.*,
    COALESCE((SELECT SUM(amount) FROM deposits WHERE loan_id = l.id), 0) AS taken,
    COALESCE((SELECT SUM(amount) FROM expenses  WHERE loan_id = l.id), 0) AS repaid
  FROM loans l
`;

interface LoanRow {
  id: number;
  title: string;
  source: string | null;
  amount: number;
  date_taken: string;
  date_due: string;
  note: string | null;
  taken: number;
  repaid: number;
}

function withRemaining(rows: LoanRow[]) {
  const today = todayISO();
  return rows.map((r) => ({
    ...r,
    remaining: Math.max(0, r.taken - r.repaid),
    // Просрочка считается по оставшемуся долгу: погашенный заём тревогу
    // вызывать не должен даже с датой в прошлом.
    is_overdue: r.taken - r.repaid > 0.001 && r.date_due < today,
  }));
}

ipcMain.handle('db:getLoans', () => {
  const rows = db!.prepare(`${LOAN_SELECT} ORDER BY l.date_due, l.id`).all() as LoanRow[];
  return withRemaining(rows);
});

/**
 * Создание займа вместе с внесением пришедших денег.
 *
 * Внесение и заём создаются одной транзакцией: если деньги пришли, а запись о
 * займе не завелась, получится расход без источника, и вернуть его будет нечем.
 * Пометка loan_id связывает их и убирает из статистики доходов.
 */
ipcMain.handle(
  'db:addLoan',
  (
    _,
    p: {
      title: string;
      source?: string;
      amount: number;
      dateTaken: string;
      dateDue: string;
      depositCategoryId?: number;
      accountId?: number;
      note?: string;
    }
  ) => {
    const title = (p.title || '').trim();
    if (!title) throw new Error('Название займа не может быть пустым');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Сумма займа должна быть больше нуля');
    }
    for (const [label, value] of [
      ['дата получения', p.dateTaken],
      ['дата возврата', p.dateDue],
    ] as const) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(value || '')) throw new Error(`Некорректная ${label}`);
    }

    const catId = Number(p.depositCategoryId);
    let categoryName: string | null = null;
    if (Number.isFinite(catId) && catId > 0) {
      const cat = db!.prepare('SELECT name FROM deposit_categories WHERE id = ?').get(catId) as
        | { name: string }
        | undefined;
      if (!cat) throw new Error('Категория внесения не найдена');
      categoryName = cat.name;
    }

    let loanId = 0;
    const run = db!.transaction(() => {
      const res = db!
        .prepare(
          `INSERT INTO loans (title, source, amount, date_taken, date_due, note)
           VALUES (?, ?, ?, ?, ?, ?)`
        )
        .run(
          title,
          (p.source || '').trim() || null,
          amount,
          p.dateTaken,
          p.dateDue,
          (p.note || '').trim() || null
        );
      loanId = Number(res.lastInsertRowid);

      if (categoryName) {
        db!.prepare(
          `INSERT INTO deposits (amount, date, category_id, loan_id, account_id)
           VALUES (?, ?, ?, ?, ?)`
        ).run(amount, p.dateTaken, catId, loanId, resolveAccount(p.accountId));
      }
    });
    run();

    return { success: true, id: loanId, recordedDeposit: Boolean(categoryName) };
  }
);

/** Возврат части или всей суммы: создаёт трату с пометкой loan_id */
ipcMain.handle(
  'db:repayLoan',
  (
    _,
    p: { id: number; amount: number; categoryId: number; date: string; accountId?: number }
  ) => {
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Сумма возврата должна быть больше нуля');
    }
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.date || '')) throw new Error('Некорректная дата');
    const catId = Number(p.categoryId);
    const cat = db!.prepare('SELECT name FROM categories WHERE id = ?').get(catId) as
      | { name: string }
      | undefined;
    if (!cat) throw new Error('Категория траты не найдена');

    const row = db!.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(p.id) as LoanRow | undefined;
    if (!row) throw new Error('Заём не найден');

    const run = db!.transaction(() => {
      db!.prepare(
        `INSERT INTO expenses (category_id, amount, date, note, loan_id, account_id)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(catId, amount, p.date, `Возврат: ${row.title}`, p.id, resolveAccount(p.accountId));
    });
    run();

    const fresh = db!.prepare(`${LOAN_SELECT} WHERE l.id = ?`).get(p.id) as LoanRow;
    return { success: true, remaining: Math.max(0, fresh.taken - fresh.repaid) };
  }
);

/**
 * Удаление займа уносит и связанные записи — по тем же правилам, что удаление
 * категории трат. Иначе деньги займа остались бы в базе, потеряв связь с
 * причиной, и в отчёте выглядели бы обычным доходом.
 * Возвращаем счётчики: остаток уменьшится на сумму удалённого внесения.
 */
ipcMain.handle('db:deleteLoan', (_, id: number) => {
  const counts = db!.prepare(
    `SELECT
       (SELECT COUNT(*) FROM deposits WHERE loan_id = ?) AS deposits,
       (SELECT COUNT(*) FROM expenses  WHERE loan_id = ?) AS expenses,
       (SELECT COALESCE(SUM(amount), 0) FROM deposits WHERE loan_id = ?) AS depositSum`
  ).get(id, id, id) as { deposits: number; expenses: number; depositSum: number };

  const run = db!.transaction(() => {
    db!.prepare('DELETE FROM deposits WHERE loan_id = ?').run(id);
    db!.prepare('DELETE FROM expenses WHERE loan_id = ?').run(id);
    db!.prepare('DELETE FROM loans WHERE id = ?').run(id);
  });
  run();

  return {
    success: true,
    deletedDeposits: counts.deposits,
    deletedExpenses: counts.expenses,
    depositSum: counts.depositSum,
  };
});

// ——— Регулярные внесения ———

/** Сумма к получению после удержания процента платформой */
function netIncome(amount: number, commission: number): number {
  return Math.round(amount * (1 - commission) * 100) / 100;
}

const RECURRING_INCOME_SELECT = `
  SELECT r.*, c.name AS category_name, c.color AS category_color
  FROM recurring_income r
  JOIN deposit_categories c ON r.category_id = c.id
`;

interface RecurringIncomeRow {
  id: number;
  title: string;
  category_id: number;
  amount: number;
  commission: number;
  frequency: RecurringFrequency;
  next_date: string;
  is_active: number;
  category_name: string;
}

function validateCommission(percent: number): number {
  const p = Number(percent);
  if (!Number.isFinite(p) || p < 0 || p >= 100) {
    throw new Error('Процент должен быть от 0 до 99');
  }
  return p / 100;
}

ipcMain.handle('db:getRecurringIncome', () => {
  const rows = db!.prepare(
    `${RECURRING_INCOME_SELECT} ORDER BY r.is_active DESC, r.next_date`
  ).all() as RecurringIncomeRow[];
  return rows.map((r) => ({ ...r, net: netIncome(r.amount, r.commission) }));
});

/** Выплаты, срок которых наступил — их показывает блок «Пора получить» */
ipcMain.handle('db:getDueRecurringIncome', () => {
  const today = todayISO();
  const rows = db!.prepare(
    `${RECURRING_INCOME_SELECT} WHERE r.is_active = 1 AND r.next_date <= ? ORDER BY r.next_date, r.title`
  ).all(today) as RecurringIncomeRow[];
  return rows.map((r) => ({ ...r, net: netIncome(r.amount, r.commission) }));
});

ipcMain.handle(
  'db:addRecurringIncome',
  (
    _,
    p: {
      title: string;
      categoryId: number;
      amount: number;
      commissionPercent: number;
      frequency: RecurringFrequency;
      nextDate: string;
    }
  ) => {
    const title = (p.title || '').trim();
    if (!title) throw new Error('Название не может быть пустым');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Сумма должна быть больше нуля');
    }
    const commission = validateCommission(p.commissionPercent);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.nextDate || '')) throw new Error('Некорректная дата');
    const cat = db!.prepare('SELECT id FROM deposit_categories WHERE id = ?').get(p.categoryId);
    if (!cat) throw new Error('Категория внесения не найдена');

    const result = db!.prepare(
      `INSERT INTO recurring_income (title, category_id, amount, commission, frequency, next_date)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(title, p.categoryId, amount, commission, p.frequency, p.nextDate);
    return { id: Number(result.lastInsertRowid), net: netIncome(amount, commission) };
  }
);

ipcMain.handle(
  'db:updateRecurringIncome',
  (
    _,
    p: {
      id: number;
      title: string;
      categoryId: number;
      amount: number;
      commissionPercent: number;
      frequency: RecurringFrequency;
      nextDate: string;
    }
  ) => {
    const title = (p.title || '').trim();
    if (!title) throw new Error('Название не может быть пустым');
    const amount = Number(p.amount);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw new Error('Сумма должна быть больше нуля');
    }
    const commission = validateCommission(p.commissionPercent);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(p.nextDate || '')) throw new Error('Некорректная дата');
    const cat = db!.prepare('SELECT id FROM deposit_categories WHERE id = ?').get(p.categoryId);
    if (!cat) throw new Error('Категория внесения не найдена');

    db!.prepare(
      `UPDATE recurring_income
       SET title = ?, category_id = ?, amount = ?, commission = ?, frequency = ?, next_date = ?
       WHERE id = ?`
    ).run(title, p.categoryId, amount, commission, p.frequency, p.nextDate, p.id);
    return { success: true, net: netIncome(amount, commission) };
  }
);

ipcMain.handle('db:toggleRecurringIncome', (_, id: number) => {
  db!.prepare('UPDATE recurring_income SET is_active = 1 - is_active WHERE id = ?').run(id);
  return { success: true };
});

ipcMain.handle('db:deleteRecurringIncome', (_, id: number) => {
  // Внесения, которые он уже создал, остаются: удаляется напоминание,
  // а не история поступлений.
  db!.prepare('DELETE FROM recurring_income WHERE id = ?').run(id);
  return { success: true };
});

/**
 * Отметка выплаты полученной.
 *
 * Внесение создаётся на дату выплаты, а не на сегодня — иначе выплата,
 * пришедшая в пятницу и отмеченная в понедельник, попала бы в другой месяц.
 * Дата сразу сдвигается до будущего: пропущенные выплаты не копятся,
 * одна отметка закрывает всю задолженность, как и у регулярных платежей.
 */
/**
 * Отметка выплаты полученной.
 *
 * Внесение создаётся на дату выплаты, а не на сегодня — иначе выплата,
 * пришедшая в пятницу и отмеченная в понедельник, попала бы в другой месяц.
 * Дата сразу сдвигается до будущего: пропущенные выплаты не копятся,
 * одна отметка закрывает всю задолженность, как и у регулярных платежей.
 *
 * Сумма нефиксированная: у агрегаторов каждая неделя разная, поэтому можно
 * передать ФАКТИЧЕСКУЮ сумму, пришедшую на карту. Расчётная сумма из настройки
 * используется только как значение по умолчанию и как ориентир «в месяц».
 * Настройку молча не переписываем: одна бурная неделя не должна навсегда
 * сдвинуть базовую сумму.
 *
 * Удержание агрегатора сохраняем отдельной суммой в том же внесении. Как
 * трату его записывать нельзя: внесение уже чистое, и второй вычет увёл бы
 * остаток на двойную комиссию.
 *
 * Колонка заполняется ВСЕГДА, даже когда агрегатор ничего не удержал (бонусная
 * неделя, нулевой процент): NULL здесь означает «это обычное внесение», а не
 * «удержания не было». Иначе выплата без удержания не отличилась бы от
 * обычного внесения и пропала бы с экрана движения денег. Ноль на суммах
 * ничего не меняет — он только помечает выплату.
 */
ipcMain.handle(
  'db:receiveRecurringIncome',
  (_, id: number, p?: { actualAmount?: number; accountId?: number }) => {
    const row = db!.prepare(`${RECURRING_INCOME_SELECT} WHERE r.id = ?`).get(id) as
      | RecurringIncomeRow
      | undefined;
    if (!row) throw new Error('Выплата не найдена');

    // Что пришло на руки: факт, если передан, иначе расчёт от настройки
    const actual = Number(p?.actualAmount);
    const net =
      Number.isFinite(actual) && actual > 0
        ? Math.round(actual * 100) / 100
        : netIncome(row.amount, row.commission);
    // Удержание: сколько было начислено минус сколько пришло. Ноль — тоже
    // значение: он помечает выплату агрегатора (см. выше).
    const withheld = Math.max(0, Math.round((row.amount - net) * 100) / 100);
    const nextDate = advanceUntilFuture(row.next_date, row.frequency, todayISO());

    const run = db!.transaction(() => {
      db!.prepare(
        `INSERT INTO deposits (amount, date, category_id, note, account_id, commission_amount)
         VALUES (?, ?, ?, ?, ?, ?)`
      ).run(net, row.next_date, row.category_id, row.title, resolveAccount(p?.accountId), withheld);
      db!.prepare('UPDATE recurring_income SET next_date = ? WHERE id = ?').run(nextDate, id);
    });
    run();

    return { success: true, net, withheld, date: row.next_date, nextDate };
  }
);

/** Сколько постоянно приходит в месяц — уже после удержания процентов */
ipcMain.handle('db:getRecurringIncomeMonthlyTotal', () => {
  const rows = db!.prepare(
    `SELECT amount, commission, frequency FROM recurring_income WHERE is_active = 1`
  ).all() as { amount: number; commission: number; frequency: RecurringFrequency }[];

  const perMonth: Record<RecurringFrequency, number> = {
    daily: 30,
    weekly: 4.345,
    monthly: 1,
    quarterly: 1 / 3,
    yearly: 1 / 12,
  };

  return rows.reduce(
    (sum, r) => sum + netIncome(r.amount, r.commission) * perMonth[r.frequency],
    0
  );
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
