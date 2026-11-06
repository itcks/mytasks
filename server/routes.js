const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');
const config = require('./config');
const bcrypt = require('bcryptjs');
const notify = require('./notify');

const STATUSES = ['new', 'in_progress', 'done', 'rejected'];
const PRIORITIES = ['low', 'medium', 'high'];
const STATUS_LABELS = { new: 'Новая', in_progress: 'В работе', done: 'Выполнена', rejected: 'Отклонена' };

// --- Аудит: запись в историю задачи ---
async function logAction(taskId, user, action, details) {
  try {
    await db.query(
      'INSERT INTO task_history (task_id, user_id, username, action, details) VALUES (?, ?, ?, ?, ?)',
      [taskId, user ? user.id : null, user ? user.username : null, action, details || null]
    );
  } catch (err) {
    console.error('logAction:', err.message);
  }
}

// --- Регистрация (роль по умолчанию — user) ---
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  if (!username || !password) {
    return res.status(400).json({ error: 'Требуются имя пользователя и пароль' });
  }
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );
    res.json({ message: 'User registered', userId: result.insertId });
  } catch (err) {
    if (String(err.message).includes('UNIQUE')) {
      return res.status(409).json({ error: 'Пользователь уже существует' });
    }
    res.status(500).json({ error: err.message });
  }
});

// --- Вход ---
router.post("/login", async (req, res) => {
  const { username, password } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];

    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const token = jwt.sign(
      { id: user.id, username: user.username, role: user.role },
      config.jwtSecret,
      { expiresIn: '1d' }
    );
    res.json({ token, role: user.role, username: user.username });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// --- Middleware: аутентификация токена ---
function authenticateToken(req, res, next) {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.sendStatus(401);

  jwt.verify(token, config.jwtSecret, (err, user) => {
    if (err) return res.sendStatus(403);
    req.user = user;
    next();
  });
}

// --- Middleware: только администратор ---
function requireAdmin(req, res, next) {
  if (req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }
  next();
}

// --- Список задач ---
// scope=my|all, status=active|done|all|new|in_progress|rejected,
// priority, tag, q (поиск), page, limit, sort=created|due|priority
router.get('/todos', authenticateToken, async (req, res) => {
  const scope = req.query.scope || 'my';
  const page = Math.max(1, parseInt(req.query.page) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(req.query.limit) || 10));
  const offset = (page - 1) * limit;
  const status = req.query.status || 'all';
  const { priority, tag, q } = req.query;
  const sort = req.query.sort || 'created';

  if (scope === 'all' && req.user.role !== 'admin') {
    return res.status(403).json({ error: 'Требуются права администратора' });
  }

  const where = [];
  const params = [];
  if (scope === 'all') {
    where.push('1=1');
  } else {
    where.push('(t.user_id = ? OR t.assigned_to = ?)');
    params.push(req.user.id, req.user.id);
  }

  if (status === 'done') where.push("(t.completed = 1 OR t.status = 'done')");
  else if (status === 'active') where.push("(t.completed = 0 AND t.status != 'done')");
  else if (STATUSES.includes(status)) where.push('t.status = ?', ), params.push(status);

  if (priority && PRIORITIES.includes(priority)) {
    where.push('t.priority = ?');
    params.push(priority);
  }
  if (tag) {
    where.push('t.tag = ?');
    params.push(tag);
  }
  if (q) {
    where.push('(t.text LIKE ? OR t.comment LIKE ? OR t.tag LIKE ?)');
    const like = `%${q}%`;
    params.push(like, like, like);
  }

  const whereSql = 'WHERE ' + where.join(' AND ');

  let orderSql;
  const prioSql = "CASE t.priority WHEN 'high' THEN 0 WHEN 'medium' THEN 1 ELSE 2 END";
  if (sort === 'due') orderSql = 't.due_date IS NULL, t.due_date';
  else if (sort === 'priority') orderSql = `${prioSql}, t.created_at DESC`;
  else orderSql = 't.created_at DESC';

  try {
    const [countRows] = await db.query(
      `SELECT COUNT(*) AS cnt FROM todos t ${whereSql}`,
      params
    );
    const total = countRows[0].cnt;

    const [rows] = await db.query(
      `SELECT t.*, u.username AS creator_name, a.username AS assignee_name
       FROM todos t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       ${whereSql}
       ORDER BY ${orderSql}
       LIMIT ? OFFSET ?`,
      [...params, limit, offset]
    );

    // Вложения и количество подзадач не нужны в списке — только счётчик файлов
    for (const r of rows) {
      const [att] = await db.query('SELECT COUNT(*) AS c FROM attachments WHERE task_id = ?', [r.id]);
      r.attachments = att[0].c;
    }

    res.json({ items: rows, total, page, limit });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Создание задачи ---
router.post('/todos', authenticateToken, async (req, res) => {
  const { text, createdAt, dueDate, planDate, assignedTo, priority, tag, repeatRule } = req.body;

  if (!text || !createdAt) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    let assignee = null;
    if (assignedTo && req.user.role === 'admin') {
      const [u] = await db.query(
        "SELECT id FROM users WHERE id = ? AND role IN ('engineer', 'admin')",
        [assignedTo]
      );
      if (u.length) assignee = assignedTo;
    }

    let deadline = dueDate;
    if (!deadline) {
      const base = (planDate || createdAt).split(' ')[0];
      deadline = base + ' 23:59:59';
    }

    const prio = PRIORITIES.includes(priority) ? priority : 'medium';
    const repeat = ['none', 'daily', 'weekly', 'monthly'].includes(repeatRule) ? repeatRule : 'none';

    const [result] = await db.query(
      `INSERT INTO todos (user_id, assigned_to, text, created_at, due_date, plan_at, priority, tag, repeat_rule)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [req.user.id, assignee, text, createdAt, deadline, planDate || null, prio, tag || null, repeat]
    );

    await logAction(result.insertId, req.user, 'created', `Задача создана${assignee ? ' и назначена' : ''}`);

    if (assignee && assignee !== req.user.id) {
      await notify.taskAssigned(result.insertId, assignee, req.user.username, text);
    }

    res.json({
      id: result.insertId,
      text,
      createdAt,
      dueDate: deadline,
      planDate: planDate || null,
      priority: prio,
      tag: tag || null,
      repeat_rule: repeat,
      assigned_to: assignee
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- История задачи ---
router.get('/todos/:id/history', authenticateToken, async (req, res) => {
  try {
    const [todos] = await db.query('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    const todo = todos[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });

    const isParticipant = [todo.user_id, todo.assigned_to].includes(req.user.id);
    if (!isParticipant && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const [rows] = await db.query(
      'SELECT * FROM task_history WHERE task_id = ? ORDER BY created_at ASC',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Вложения: список ---
router.get('/todos/:id/attachments', authenticateToken, async (req, res) => {
  try {
    const [todos] = await db.query('SELECT id, user_id, assigned_to FROM todos WHERE id = ?', [req.params.id]);
    const todo = todos[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });
    if (![todo.user_id, todo.assigned_to].includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const [rows] = await db.query(
      'SELECT id, filename, mime, size, created_at FROM attachments WHERE task_id = ? ORDER BY id',
      [req.params.id]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Вложения: загрузка (JSON c base64) ---
router.post('/todos/:id/attachments', authenticateToken, async (req, res) => {
  const { filename, mime, dataBase64 } = req.body;
  if (!filename || !dataBase64) {
    return res.status(400).json({ error: 'Нужны filename и dataBase64' });
  }
  try {
    const [todos] = await db.query('SELECT id, user_id, assigned_to FROM todos WHERE id = ?', [req.params.id]);
    const todo = todos[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });
    if (![todo.user_id, todo.assigned_to].includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет доступа' });
    }

    const buf = Buffer.from(dataBase64, 'base64');
    if (buf.length > 10 * 1024 * 1024) {
      return res.status(413).json({ error: 'Файл больше 10 МБ' });
    }
    const [result] = await db.query(
      'INSERT INTO attachments (task_id, filename, mime, size, data, uploaded_by) VALUES (?, ?, ?, ?, ?, ?)',
      [todo.id, filename, mime || 'application/octet-stream', buf.length, buf, req.user.id]
    );
    await logAction(todo.id, req.user, 'attachment', `Прикреплён файл: ${filename}`);
    res.json({ id: result.insertId, filename, size: buf.length });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Вложения: скачивание ---
router.get('/attachments/:id', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM attachments WHERE id = ?', [req.params.id]);
    const att = rows[0];
    if (!att) return res.status(404).json({ error: 'Файл не найден' });
    const [todos] = await db.query('SELECT id, user_id, assigned_to FROM todos WHERE id = ?', [att.task_id]);
    const todo = todos[0];
    if (![todo.user_id, todo.assigned_to].includes(req.user.id) && req.user.role !== 'admin') {
      return res.status(403).json({ error: 'Нет доступа' });
    }
    const data = typeof att.data === 'string' ? Buffer.from(att.data, 'binary') : Buffer.from(att.data);
    res.setHeader('Content-Type', att.mime || 'application/octet-stream');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(att.filename)}`);
    res.send(data);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Обновление задачи (редактирование, статусы, исполнители) ---
router.put('/todos/:id', authenticateToken, async (req, res) => {
  const {
    completed, comment, completedAt, assignedTo, dueDate, planDate,
    text, status, priority, tag
  } = req.body;

  try {
    const [rows] = await db.query('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    const todo = rows[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });

    const isOwner = todo.user_id === req.user.id;
    const isAssignee = todo.assigned_to === req.user.id;
    const isAdmin = req.user.role === 'admin';

    if (!isOwner && !isAssignee && !isAdmin) {
      return res.status(403).json({ error: 'Нет доступа к этой задаче' });
    }

    const changes = [];
    const fields = [];
    const params = [];

    const setField = (column, value, label) => {
      fields.push(`${column} = ?`);
      params.push(value);
      if (String(todo[column === 'due_date' ? 'due_date' : column]) !== String(value ?? '')) {
        changes.push(`${label}: «${todo[column] ?? '—'}» → «${value ?? '—'}»`);
      }
    };

    if (text !== undefined && (isOwner || isAdmin)) setField('text', text, 'Текст');
    if (planDate !== undefined && (isOwner || isAdmin)) setField('plan_at', planDate, 'Дата задачи');
    if (dueDate !== undefined && (isOwner || isAdmin)) setField('due_date', dueDate, 'Срок');
    if (tag !== undefined && (isOwner || isAdmin)) setField('tag', tag, 'Тег');
    if (priority !== undefined && PRIORITIES.includes(priority) && (isOwner || isAdmin)) {
      setField('priority', priority, 'Приоритет');
    }
    if (assignedTo !== undefined && (isAdmin || (req.user.role === 'engineer' && isOwner))) {
      if (String(todo.assigned_to) !== String(assignedTo ?? '')) {
        const [u] = assignedTo
          ? await db.query('SELECT username FROM users WHERE id = ?', [assignedTo])
          : [[]];
        changes.push(`Исполнитель: «${todo.assigned_to || '—'}» → «${assignedTo || '—'}»`);
        if (assignedTo && Number(assignedTo) !== req.user.id) {
          await notify.taskAssigned(todo.id, assignedTo, req.user.username, text || todo.text);
        }
      }
      fields.push('assigned_to = ?');
      params.push(assignedTo);
    }

    // Статус: исполнитель, владелец или админ
    if (status !== undefined && STATUSES.includes(status) && (isAssignee || isOwner || isAdmin)) {
      if (todo.status !== status) {
        changes.push(`Статус: «${STATUS_LABELS[todo.status] || todo.status}» → «${STATUS_LABELS[status]}»`);
        if (status === 'done' || status === 'rejected') {
          const who = isAssignee ? req.user.username : (todo.assignee_name || 'исполнитель');
          await notify.taskStatus(todo.id, isAssignee ? todo.user_id : todo.assigned_to, req.user.username, todo.text, status);
        }
      }
      fields.push('status = ?');
      params.push(status);
      fields.push('completed = ?');
      params.push(status === 'done' ? 1 : 0);
      if (status === 'done') {
        fields.push('completed_at = ?');
        params.push(completedAt || new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, ''));
      } else {
        fields.push('completed_at = NULL');
      }
    } else if (completed !== undefined && (isAssignee || isOwner || isAdmin)) {
      const newStatus = completed ? 'done' : 'new';
      if (todo.status !== newStatus) {
        changes.push(`Статус: «${STATUS_LABELS[todo.status] || todo.status}» → «${STATUS_LABELS[newStatus]}»`);
        await notify.taskStatus(todo.id, isAssignee ? todo.user_id : todo.assigned_to, req.user.username, todo.text, newStatus);
      }
      fields.push('status = ?');
      params.push(newStatus);
      fields.push('completed = ?');
      params.push(completed ? 1 : 0);
      if (completed) {
        fields.push('completed_at = ?');
        params.push(completedAt || null);
        fields.push('comment = ?');
        params.push(comment || null);
      } else {
        fields.push('completed_at = NULL');
        fields.push('comment = NULL');
      }
    } else if (comment !== undefined && (isAssignee || isOwner || isAdmin)) {
      setField('comment', comment, 'Комментарий');
    }

    if (!fields.length) {
      return res.status(400).json({ error: 'Нет полей для обновления' });
    }

    params.push(todo.id);
    await db.query(`UPDATE todos SET ${fields.join(', ')} WHERE id = ?`, params);

    if (changes.length) {
      await logAction(todo.id, req.user, 'updated', changes.join('; '));
    }

    // Повторяющаяся задача: при выполнении создаём следующую
    if ((status === 'done' || completed === true) && todo.repeat_rule && todo.repeat_rule !== 'none') {
      const base = todo.plan_at || todo.due_date || todo.created_at;
      const d = new Date(String(base).replace(' ', 'T'));
      if (!isNaN(d.getTime())) {
        if (todo.repeat_rule === 'daily') d.setDate(d.getDate() + 1);
        if (todo.repeat_rule === 'weekly') d.setDate(d.getDate() + 7);
        if (todo.repeat_rule === 'monthly') d.setMonth(d.getMonth() + 1);
        const pad = n => String(n).padStart(2, '0');
        const nextDate =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} ` +
          `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
        const nextDue =
          `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())} 23:59:59`;
        const now = new Date().toISOString().replace('T', ' ').replace(/\.\d+Z$/, '');
        const [r2] = await db.query(
          `INSERT INTO todos (user_id, assigned_to, text, created_at, due_date, plan_at, priority, tag, repeat_rule)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [todo.user_id, todo.assigned_to, todo.text, now, nextDue, nextDate, todo.priority, todo.tag, todo.repeat_rule]
        );
        await logAction(r2.insertId, req.user, 'created', `Повтор задачи №${todo.id}`);
        if (todo.assigned_to) {
          await notify.taskAssigned(r2.insertId, todo.assigned_to, 'система', `Повтор задачи: ${todo.text}`);
        }
      }
    }

    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Удаление задачи: только администратор ---
router.delete('/todos/:id', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    const todo = rows[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });
    await db.query('DELETE FROM todos WHERE id = ?', [req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Список пользователей ---
router.get('/users', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT id, username, role, max_chat_id FROM users ORDER BY role, username'
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Смена роли (только админ) ---
router.put('/users/:id/role', authenticateToken, requireAdmin, async (req, res) => {
  const { role } = req.body;
  if (!['user', 'engineer', 'admin'].includes(role)) {
    return res.status(400).json({ error: 'Недопустимая роль' });
  }
  try {
    await db.query('UPDATE users SET role = ? WHERE id = ?', [role, req.params.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Удаление пользователя (только админ, нельзя удалить себя) ---
router.delete('/users/:id', authenticateToken, requireAdmin, async (req, res) => {
  if (Number(req.params.id) === req.user.id) {
    return res.status(400).json({ error: 'Нельзя удалить самого себя' });
  }
  try {
    const [result] = await db.query('DELETE FROM users WHERE id = ?', [req.params.id]);
    if (!result.affectedRows) return res.status(404).json({ error: 'Пользователь не найден' });
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Уведомления текущего пользователя ---
router.get('/notifications', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query(
      'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
      [req.user.id]
    );
    const [unread] = await db.query(
      'SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0',
      [req.user.id]
    );
    res.json({ items: rows, unread: unread[0].c });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/notifications/read', authenticateToken, async (req, res) => {
  try {
    await db.query('UPDATE notifications SET read = 1 WHERE user_id = ?', [req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Отчёты (только админ) ---
router.get('/reports', authenticateToken, requireAdmin, async (req, res) => {
  const { from, to } = req.query;
  const period = [];
  const params = [];
  if (from) { period.push('t.created_at >= ?'); params.push(from + ' 00:00:00'); }
  if (to) { period.push('t.created_at <= ?'); params.push(to + ' 23:59:59'); }
  const whereSql = period.length ? 'WHERE ' + period.join(' AND ') : '';

  try {
    const [totals] = await db.query(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN t.status = 'in_progress' THEN 1 ELSE 0 END) AS in_progress,
              SUM(CASE WHEN t.status = 'new' AND t.completed = 0 THEN 1 ELSE 0 END) AS fresh,
              SUM(CASE WHEN t.completed = 0 AND t.due_date < datetime('now') THEN 1 ELSE 0 END) AS overdue
       FROM todos t ${whereSql}`,
      params
    );
    const [byEngineer] = await db.query(
      `SELECT COALESCE(a.username, '— не назначен —') AS engineer,
              COUNT(*) AS total,
              SUM(CASE WHEN t.status = 'done' THEN 1 ELSE 0 END) AS done,
              SUM(CASE WHEN t.completed = 0 AND t.due_date < datetime('now') THEN 1 ELSE 0 END) AS overdue,
              AVG(CASE WHEN t.completed = 1 AND t.completed_at IS NOT NULL
                  THEN (julianday(t.completed_at) - julianday(t.created_at)) * 24 END) AS avg_hours
       FROM todos t
       LEFT JOIN users a ON t.assigned_to = a.id
       ${whereSql}
       GROUP BY a.id
       ORDER BY total DESC`,
      params
    );
    res.json({
      totals: totals[0],
      byEngineer: byEngineer.map(r => ({ ...r, avg_hours: r.avg_hours ? Math.round(r.avg_hours * 10) / 10 : null }))
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// --- Выгрузка в CSV (только админ) ---
function csvEscape(value) {
  const s = value === null || value === undefined ? '' : String(value);
  return '"' + s.replace(/"/g, '""') + '"';
}

router.get('/export/csv', authenticateToken, requireAdmin, async (req, res) => {
  try {
    const [rows] = await db.query(
      `SELECT t.id, u.username AS creator, a.username AS assignee, t.text, t.comment,
              t.status, t.priority, t.tag, t.created_at, t.due_date, t.completed, t.completed_at
       FROM todos t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       ORDER BY t.created_at DESC`
    );
    const header = [
      'ID', 'Автор', 'Исполнитель', 'Задача', 'Комментарий', 'Статус', 'Приоритет', 'Тег',
      'Создано', 'Срок', 'Выполнено', 'Завершено'
    ];
    const lines = [header.map(csvEscape).join(';')];
    for (const r of rows) {
      lines.push([
        r.id, r.creator, r.assignee, r.text, r.comment,
        STATUS_LABELS[r.status] || r.status, r.priority, r.tag,
        r.created_at, r.due_date,
        r.completed ? 'да' : 'нет', r.completed_at
      ].map(csvEscape).join(';'));
    }
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="tasks.csv"');
    res.send('\ufeff' + lines.join('\r\n'));
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// ============================================================
// Прямой API для бота (защита по заголовку X-Bot-Key)
// ============================================================

function requireBotKey(req, res, next) {
  if (req.headers['x-bot-key'] !== config.botApiKey) {
    return res.status(403).json({ error: 'Неверный ключ бота' });
  }
  next();
}

router.use('/bot', requireBotKey);

// Привязка мессенджера к пользователю
router.post('/bot/link', async (req, res) => {
  const { username, password, chatId, messenger } = req.body;
  try {
    const [rows] = await db.query('SELECT * FROM users WHERE username = ?', [username]);
    const user = rows[0];
    if (!user || !(await bcrypt.compare(password, user.password))) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }
    await db.query('UPDATE users SET max_chat_id = ? WHERE id = ?', [chatId, user.id]);
    res.json({ success: true, userId: user.id, role: user.role });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Задачи пользователя по chatId
router.get('/bot/tasks/:chatId', async (req, res) => {
  try {
    const [users] = await db.query(
      'SELECT id FROM users WHERE max_chat_id = ?', [req.params.chatId]
    );
    if (!users.length) return res.status(404).json({ error: 'Пользователь не привязан' });
    const userId = users[0].id;

    const [rows] = await db.query(
      `SELECT t.*, u.username AS creator_name, a.username AS assignee_name
       FROM todos t
       LEFT JOIN users u ON t.user_id = u.id
       LEFT JOIN users a ON t.assigned_to = a.id
       WHERE t.assigned_to = ? OR t.user_id = ?
       ORDER BY t.completed ASC, t.due_date IS NULL, t.due_date`,
      [userId, userId]
    );
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Выполнение задачи ботом
router.post('/bot/tasks/:id/complete', async (req, res) => {
  const { chatId, comment } = req.body;
  try {
    const [users] = await db.query(
      'SELECT id FROM users WHERE max_chat_id = ?', [chatId]
    );
    if (!users.length) return res.status(404).json({ error: 'Пользователь не привязан' });
    const userId = users[0].id;

    const [rows] = await db.query('SELECT * FROM todos WHERE id = ?', [req.params.id]);
    const todo = rows[0];
    if (!todo) return res.status(404).json({ error: 'Задача не найдена' });
    if (todo.user_id !== userId && todo.assigned_to !== userId) {
      return res.status(403).json({ error: 'Нет доступа к этой задаче' });
    }

    await db.query(
      'UPDATE todos SET completed = 1, status = ?, completed_at = CURRENT_TIMESTAMP, comment = ? WHERE id = ?',
      ['done', comment || null, todo.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
