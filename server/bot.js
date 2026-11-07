const db = require('./db');
const config = require('./config');

// ---- МАКС-бот: слушатель (long polling) и отправка сообщений ----
// Токен задаётся в .env (MAX_BOT_TOKEN). Привязка пользователя к чату:
// 1) в веб-интерфейсе пользователь получает одноразовый код (10 минут)
// 2) отправляет его боту в МАКС — чат сохраняется в users.max_chat_id
// Команды бота: «мои задачи», «выполнил <номер>», «помощь».

const API = () => config.maxApiUrl;
const TOKEN = () => config.maxBotToken;

async function apiGet(path) {
  const res = await fetch(`${API()}${path}${path.includes('?') ? '&' : '?'}access_token=${TOKEN()}`);
  if (!res.ok) throw new Error(`MAX API ${res.status}`);
  return res.json();
}

async function apiPost(path, body) {
  const res = await fetch(`${API()}${path}?access_token=${TOKEN()}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body)
  });
  if (!res.ok) {
    const t = await res.text().catch(() => '');
    throw new Error(`MAX API ${res.status}: ${t}`);
  }
  return res.json();
}

async function send(chatId, text) {
  if (!TOKEN() || !chatId) return;
  try {
    await apiPost('/messages', { chat_id: chatId, text });
  } catch (err) {
    console.error('MAX bot send:', err.message);
  }
}

async function reply(msg, text) {
  const chatId = msg.chat_id || (msg.chat && msg.chat.chat_id) || msg.sender?.chat_id;
  if (chatId) await send(chatId, text);
}

// ---- Генерация кода привязки (вызывается из API) ----
async function createLinkCode(user) {
  const code = Math.random().toString(36).slice(2, 8).toUpperCase();
  const expires = new Date(Date.now() + 10 * 60 * 1000)
    .toISOString().replace('T', ' ').slice(0, 19);
  await db.query(
    `INSERT INTO link_codes (code, user_id, expires_at, used)
     VALUES (?, ?, ?, 0)`,
    [code, user.id, expires]
  );
  return { code, expires_at: expires };
}

async function consumeCode(code, chatId) {
  const [rows] = await db.query(
    'SELECT * FROM link_codes WHERE UPPER(code) = ? AND used = 0',
    [String(code).trim().toUpperCase()]
  );
  const link = rows[0];
  if (!link) return { ok: false, error: 'Код не найден' };
  if (link.expires_at < new Date().toISOString().replace('T', ' ').slice(0, 19)) {
    return { ok: false, error: 'Код истёк, сгенерируйте новый в приложении' };
  }
  await db.query('UPDATE link_codes SET used = 1 WHERE id = ?', [link.id]);
  await db.query('UPDATE users SET max_chat_id = ? WHERE id = ?', [chatId, link.user_id]);
  const [users] = await db.query('SELECT username FROM users WHERE id = ?', [link.user_id]);
  return { ok: true, username: users[0]?.username };
}

// ---- Команды бота ----
function fmtTasks(tasks) {
  if (!tasks.length) return 'У вас нет задач.';
  const statusIcons = { new: '🆕', in_progress: '🔨', done: '✅', rejected: '❌' };
  const prioIcons = { high: '❗', medium: '', low: '⬇️' };
  return tasks.slice(0, 20).map(t => {
    const parts = [
      statusIcons[t.status] || '',
      prioIcons[t.priority] || '',
      `№${t.id} ${t.text}`
    ];
    if (t.due_date) parts.push(`— до ${String(t.due_date).slice(0, 16)}`);
    return parts.filter(Boolean).join(' ').trim();
  }).join('\n') + (tasks.length > 20 ? `\n\n…и ещё ${tasks.length - 20}` : '');
}

async function userByChat(chatId) {
  const [users] = await db.query('SELECT id, username FROM users WHERE max_chat_id = ?', [chatId]);
  return users[0] || null;
}

async function userTasks(userId) {
  const [rows] = await db.query(
    `SELECT t.*, a.username AS assignee_name
     FROM todos t
     LEFT JOIN users a ON t.assigned_to = a.id
     WHERE t.assigned_to = ? OR t.user_id = ?
     ORDER BY t.completed ASC, t.due_date IS NULL, t.due_date
     LIMIT 100`,
    [userId, userId]
  );
  return rows;
}

async function handleText(msg, text) {
  const chatId = msg.chat_id || (msg.chat && msg.chat.chat_id) || msg.sender?.chat_id;
  if (!chatId) return;
  const t = text.trim();

  // Привязка: любой текст длиной 6, похожий на код
  if (/^[A-Za-z0-9]{6}$/.test(t)) {
    const res = await consumeCode(t, chatId);
    if (res.ok) {
      await reply(msg, `✅ Готово! Чат привязан к пользователю ${res.username}. Теперь сюда будут приходить уведомления.\n\nКоманды: «мои задачи», «выполнил <номер>».`);
    } else {
      await reply(msg, `❌ ${res.error}`);
    }
    return;
  }

  const lower = t.toLowerCase();
  if (lower === 'старт' || lower === 'start' || lower === 'помощь' || lower === 'help') {
    await reply(msg,
      'Привет! Это бот системы задач MyTasks.\n\n' +
      'Чтобы получать уведомления:\n' +
      '1. Откройте приложение и нажмите 🔔 → «Привязать МАКС».\n' +
      '2. Скопируйте код и отправьте его мне одним сообщением.\n\n' +
      'Команды:\n• мои задачи — список ваших задач\n• выполнял N — отметить задачу выполненной');
    return;
  }

  if (lower === 'мои задачи' || lower === 'задачи') {
    const user = await userByChat(chatId);
    if (!user) return reply(msg, 'Сначала привяжите аккаунт: отправьте код из приложения (🔔 → «Привязать МАКС»).');
    const tasks = await userTasks(user.id);
    return reply(msg, fmtTasks(tasks.filter(x => !x.completed)) + '\n\n✅ Выполнено сегодня: ' + tasks.filter(x => x.completed).length);
  }

  const doneMatch = lower.match(/^(?:выполнил|выполнено|done)\s*#?\s*(\d+)$/);
  if (doneMatch) {
    const user = await userByChat(chatId);
    if (!user) return reply(msg, 'Сначала привяжите аккаунт: отправьте код из приложения.');
    const id = doneMatch[1];
    const [todos] = await db.query('SELECT * FROM todos WHERE id = ?', [id]);
    const todo = todos[0];
    if (!todo) return reply(msg, 'Задача не найдена.');
    if (todo.user_id !== user.id && todo.assigned_to !== user.id) {
      return reply(msg, 'Нет доступа к этой задаче.');
    }
    await db.query(
      "UPDATE todos SET completed = 1, status = 'done', completed_at = datetime('now') WHERE id = ?",
      [id]
    );
    await db.query(
      'INSERT INTO task_history (task_id, user_id, username, action, details) VALUES (?, ?, ?, ?, ?)',
      [todo.id, user.id, user.username, 'updated', 'Статус → «Выполнена» (через бота МАКС)']
    );
    await reply(msg, `✅ Задача №${id} выполнена.`);
    return;
  }

  // Ничего не подошло — тихо игнорируем незнакомый текст (кроме кодов)
}

// ---- Long polling ----
let marker = null;
let running = false;

async function poll() {
  if (!TOKEN()) return;
  running = true;
  while (running) {
    try {
      const url = marker !== null
        ? `/updates?marker=${marker}&timeout=30`
        : '/updates?timeout=30';
      const data = await apiGet(url);
      marker = data.marker !== undefined ? data.marker : marker;
      for (const upd of data.updates || []) {
        const msg = upd.message || upd;
        const body = msg.body || {};
        const text = body.text || body.caption || '';
        if (text) await handleText(msg, text).catch(e => console.error('bot cmd:', e.message));
      }
    } catch (err) {
      console.error('MAX bot poll:', err.message);
      await new Promise(r => setTimeout(r, 15000));
    }
  }
}

function start() {
  if (!TOKEN()) {
    console.log('MAX_BOT_TOKEN не задан — бот МАКС выключен.');
    return;
  }
  poll().catch(e => console.error('MAX bot:', e.message));
  console.log('Бот МАКС запущен (long polling).');
}

module.exports = { start, send, createLinkCode, handleText };
