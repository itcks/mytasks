const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const db = new DatabaseSync(path.join(__dirname, 'data.sqlite'));
db.exec('PRAGMA journal_mode = WAL');
db.exec('PRAGMA foreign_keys = ON');

// Инициализация схемы
db.exec(`
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT NOT NULL UNIQUE,
  password TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'user' CHECK (role IN ('user', 'engineer', 'admin')),
  telegram_chat_id TEXT DEFAULT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS todos (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  assigned_to INTEGER DEFAULT NULL,
  text TEXT NOT NULL,
  comment TEXT,
  created_at TEXT NOT NULL,
  due_date TEXT DEFAULT NULL,
  completed INTEGER NOT NULL DEFAULT 0,
  completed_at TEXT DEFAULT NULL,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (assigned_to) REFERENCES users(id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_todos_user ON todos(user_id);
CREATE INDEX IF NOT EXISTS idx_todos_assigned ON todos(assigned_to);
CREATE INDEX IF NOT EXISTS idx_todos_completed ON todos(completed);
`);

// Миграции построчно: колонка добавляется, только если её ещё нет
function ensureColumn(table, column, ddl) {
  try {
    db.prepare(`SELECT ${column} FROM ${table} LIMIT 1`).get();
  } catch {
    db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
  }
}

ensureColumn('todos', 'plan_at', "plan_at TEXT DEFAULT NULL");
ensureColumn('todos', 'status', "status TEXT NOT NULL DEFAULT 'new' CHECK (status IN ('new','in_progress','done','rejected'))");
ensureColumn('todos', 'priority', "priority TEXT NOT NULL DEFAULT 'medium' CHECK (priority IN ('low','medium','high'))");
ensureColumn('todos', 'tag', "tag TEXT DEFAULT NULL");
ensureColumn('todos', 'repeat_rule', "repeat_rule TEXT NOT NULL DEFAULT 'none' CHECK (repeat_rule IN ('none','daily','weekly','monthly'))");
ensureColumn('todos', 'reminded_at', "reminded_at TEXT DEFAULT NULL");
ensureColumn('todos', 'overdue_notified_at', "overdue_notified_at TEXT DEFAULT NULL");
ensureColumn('users', 'max_chat_id', "max_chat_id TEXT DEFAULT NULL");

db.exec(`
CREATE TABLE IF NOT EXISTS task_history (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  user_id INTEGER,
  username TEXT,
  action TEXT NOT NULL,
  details TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES todos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS attachments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id INTEGER NOT NULL,
  filename TEXT NOT NULL,
  mime TEXT,
  size INTEGER,
  data BLOB NOT NULL,
  uploaded_by INTEGER,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (task_id) REFERENCES todos(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS notifications (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  task_id INTEGER,
  type TEXT NOT NULL,
  text TEXT NOT NULL,
  read INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_notifications_user ON notifications(user_id, read);

CREATE TABLE IF NOT EXISTS link_codes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  code TEXT NOT NULL UNIQUE,
  user_id INTEGER NOT NULL,
  expires_at TEXT NOT NULL,
  used INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
`);

// Миграция: колонка plan_at (дата и время задачи), due_date — срок исполнения
try {
  db.prepare("SELECT plan_at FROM todos LIMIT 1").get();
} catch {
  db.exec('ALTER TABLE todos ADD COLUMN plan_at TEXT DEFAULT NULL');
}

// Обёртка query() для совместимости с кодом роутов:
// SELECT -> promise resolves [rows]
// INSERT/UPDATE/DELETE -> promise resolves [{ insertId, affectedRows }]
db.query = function (sql, params = []) {
  try {
    const stmt = db.prepare(sql);
    const isSelect = /^(select|with)/i.test(sql.trim());
    if (isSelect) {
      return Promise.resolve([stmt.all(...params)]);
    }
    const info = stmt.run(...params);
    return Promise.resolve([{ insertId: Number(info.lastInsertRowid), affectedRows: info.changes }]);
  } catch (err) {
    return Promise.reject(err);
  }
};

module.exports = db;
