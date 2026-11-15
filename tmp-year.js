/** Verify the year summary query against the user's DB. Temp file. */
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });

const year = 2026;
const depRows = db.prepare(
  `SELECT strftime('%m', date) AS m, COALESCE(SUM(amount), 0) AS s
   FROM deposits
   WHERE date(date) BETWEEN date(?) AND date(?)
     AND loan_id IS NULL
   GROUP BY m`
).all(`${year}-01-01`, `${year}-12-31`);
const expRows = db.prepare(
  `SELECT strftime('%m', date) AS m, COALESCE(SUM(amount), 0) AS s
   FROM expenses
   WHERE date(date) BETWEEN date(?) AND date(?)
     AND loan_id IS NULL
   GROUP BY m`
).all(`${year}-01-01`, `${year}-12-31`);

const depMap = new Map(depRows.map((r) => [r.m, r.s]));
const expMap = new Map(expRows.map((r) => [r.m, r.s]));

console.log('month | deposits | expenses | net');
let tD = 0, tE = 0;
for (let i = 1; i <= 12; i++) {
  const k = String(i).padStart(2, '0');
  const d = depMap.get(k) ?? 0;
  const e = expMap.get(k) ?? 0;
  tD += d; tE += e;
  if (d || e) console.log(`${k} | ${d} | ${e} | ${d - e}`);
}
console.log(`TOTAL | ${tD} | ${tE} | ${tD - tE}`);

// Cross-check with the full-range query
const allD = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM deposits WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL`).get(`${year}-01-01`, `${year}-12-31`).s;
const allE = db.prepare(`SELECT COALESCE(SUM(amount),0) s FROM expenses WHERE date(date) BETWEEN date(?) AND date(?) AND loan_id IS NULL`).get(`${year}-01-01`, `${year}-12-31`).s;
console.log(`cross-check: deposits ${allD} (${allD === tD ? 'OK' : 'MISMATCH'}), expenses ${allE} (${allE === tE ? 'OK' : 'MISMATCH'})`);

db.close();