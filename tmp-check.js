/** Проверка отсутствия тестовых списаний. Temp file. */
const Database = require('better-sqlite3');
const db = new Database(process.argv[2], { readonly: true });
console.log('списаний в базе:', db.prepare('SELECT COUNT(*) c FROM writeoffs').get().c);
db.close();