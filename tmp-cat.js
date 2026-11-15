/** Verify category-filtered report on the user's DB. Temp file. */
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });

const cats = db.prepare("SELECT id, name FROM categories WHERE type = 'expense' ORDER BY id").all();
console.log('expense categories:', JSON.stringify(cats));

const s = '2026-10-01', e = '2026-10-31';
const all = db.prepare(
  `SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL`
).get(s, e).s;
console.log(`all expenses Oct: ${all}`);

for (const c of cats) {
  const v = db.prepare(
    `SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL AND category_id = ?`
  ).get(s, e, c.id).s;
  const cnt = db.prepare(
    `SELECT COUNT(*) n FROM expenses WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL AND category_id = ?`
  ).get(s, e, c.id).n;
  console.log(`  ${c.name}: ${v} (${cnt} оп.)`);
}

// Null category (deleted)
const nullCat = db.prepare(
  `SELECT COALESCE(SUM(amount),0) s, COUNT(*) n FROM expenses WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL AND category_id IS NULL`
).get(s, e);
console.log(`  Без категории: ${nullCat.s} (${nullCat.n} оп.)`);

db.close();