/**
 * Генератор шаблонной БД для установщика.
 *
 * Запускается ПОД ELECTRON (better-sqlite3 собран под ABI Electron,
 * обычный Node его не загрузит).
 *
 *   npx electron scripts/build-template-db.js
 *
 * Результат: resources/template/expenses.db — пустая БД со схемой
 * и дефолтными категориями. electron-builder положит её в
 * resources/template/ рядом с приложением, а main.ts при первом
 * запуске скопирует её в %APPDATA%.
 */

const { app } = require('electron');
const path = require('path');
const fs = require('fs');

app.disableHardwareAcceleration();

app.whenReady().then(() => {
  const root = path.join(__dirname, '..');
  const outDir = path.join(root, 'resources', 'template');
  const outFile = path.join(outDir, 'expenses.db');

  fs.mkdirSync(outDir, { recursive: true });
  if (fs.existsSync(outFile)) fs.unlinkSync(outFile);

  // Схема берётся из скомпилированного модуля — один источник истины
  const { applySchema } = require(path.join(root, 'dist', 'main', 'schema.js'));
  const Database = require('better-sqlite3');

  const db = new Database(outFile);
  applySchema(db);

  // Проверка целостности шаблона
  const cats = db.prepare('SELECT COUNT(*) c FROM categories').get().c;
  const subs = db.prepare('SELECT COUNT(*) c FROM subcategories').get().c;
  const tables = db
    .prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all()
    .map((r) => r.name);
  const integrity = db.pragma('integrity_check', { simple: true });

  console.log('TEMPLATE DB:', outFile);
  console.log('tables   :', tables.join(', '));
  console.log('categories:', cats);
  console.log('subcategories:', subs);
  console.log('integrity:', integrity);

  db.close();

  const ok =
    integrity === 'ok' &&
    cats === 2 &&
    subs === 9 &&
    ['balance_history', 'categories', 'expenses', 'subcategories'].every((t) =>
      tables.includes(t)
    );

  console.log(ok ? 'OK' : 'FAILED');
  app.exit(ok ? 0 : 1);
});