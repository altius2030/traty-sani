/** Быстрая проверка шаблонной базы. Temp file. */
const Database = require('better-sqlite3');
const path = require('path');
const db = new Database(path.join(__dirname, 'resources', 'template', 'expenses.db'), { readonly: true });
let bad = 0;
for (const t of ['expenses','deposits','transfers','loans','recurring_income','balance_history','subitems','settings']) {
  const c = db.prepare(`SELECT COUNT(*) c FROM ${t}`).get().c;
  if (c !== 0) { console.log('НЕ ПУСТО:', t, c); bad++; }
}
console.log('accounts:', db.prepare('SELECT COUNT(*) c FROM accounts').get().c);
console.log('categories:', db.prepare('SELECT COUNT(*) c FROM categories').get().c);
console.log('subcategories:', db.prepare('SELECT COUNT(*) c FROM subcategories').get().c);
console.log('integrity:', db.pragma('integrity_check', { simple: true }));
console.log(bad === 0 ? 'ШАБЛОН ЧИСТЫЙ' : 'ПРОБЛЕМА');
db.close();