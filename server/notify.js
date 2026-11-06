const db = require('./db');
const config = require('./config');

// Отправка сообщения в MAX Bot API (если настроен MAX_BOT_TOKEN)
async function sendMax(chatId, text) {
  const token = config.maxBotToken;
  if (!token || !chatId) return;
  try {
    await fetch(`${config.maxApiUrl}/messages?chat_id=${chatId}&access_token=${token}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text })
    });
  } catch (err) {
    console.error('MAX send:', err.message);
  }
}

async function push(userId, taskId, type, text) {
  try {
    await db.query(
      'INSERT INTO notifications (user_id, task_id, type, text) VALUES (?, ?, ?, ?)',
      [userId, taskId, type, text]
    );
  } catch (err) {
    console.error('notify.push:', err.message);
  }
  try {
    const [users] = await db.query('SELECT max_chat_id FROM users WHERE id = ?', [userId]);
    if (users.length && users[0].max_chat_id) {
      await sendMax(users[0].max_chat_id, text);
    }
  } catch (err) {
    console.error('notify.max:', err.message);
  }
}

async function taskAssigned(taskId, assigneeId, byUser, taskText) {
  await push(
    assigneeId, taskId, 'assigned',
    `${byUser} назначил(а) вам задачу: «${taskText}» (№${taskId})`
  );
}

async function taskStatus(taskId, recipientId, byUser, taskText, status) {
  const label = { done: 'выполнил(а)', rejected: 'отклонил(а)', in_progress: 'взял(а) в работу', new: 'вернул(а) в новые' }[status] || status;
  if (!recipientId) return;
  await push(
    recipientId, taskId, 'status',
    `${byUser} ${label} задачу «${taskText}» (№${taskId})`
  );
}

// Напоминания: срок через <24ч и просрочка (раз в минуту из server.js)
async function reminders() {
  const now = new Date();
  const pad = n => String(n).padStart(2, '0');
  const nowStr =
    `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ` +
    `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
  const in24h = new Date(now.getTime() + 24 * 3600 * 1000);
  const soonStr =
    `${in24h.getFullYear()}-${pad(in24h.getMonth() + 1)}-${pad(in24h.getDate())} ` +
    `${pad(in24h.getHours())}:${pad(in24h.getMinutes())}:${pad(in24h.getSeconds())}`;

  try {
    // Скоро истекает
    const [soon] = await db.query(
      `SELECT t.*, a.max_chat_id FROM todos t LEFT JOIN users a ON t.assigned_to = a.id
       WHERE t.completed = 0 AND t.status != 'done'
         AND t.due_date IS NOT NULL AND t.due_date > ? AND t.due_date <= ?
         AND t.reminded_at IS NULL
         AND (t.assigned_to IS NOT NULL OR t.user_id IS NOT NULL)`,
      [nowStr, soonStr]
    );
    for (const t of soon) {
      const text = `Скоро срок по задаче «${t.text}» (№${t.id}): ${t.due_date}`;
      if (t.assigned_to) await push(t.assigned_to, t.id, 'reminder', text);
      if (t.user_id && t.user_id !== t.assigned_to) await push(t.user_id, t.id, 'reminder', text);
      await db.query('UPDATE todos SET reminded_at = ? WHERE id = ?', [nowStr, t.id]);
    }

    // Просрочено
    const [overdue] = await db.query(
      `SELECT t.*, a.max_chat_id FROM todos t LEFT JOIN users a ON t.assigned_to = a.id
       WHERE t.completed = 0 AND t.status != 'done'
         AND t.due_date IS NOT NULL AND t.due_date <= ?
         AND t.overdue_notified_at IS NULL`,
      [nowStr]
    );
    for (const t of overdue) {
      const text = `Просрочена задача «${t.text}» (№${t.id}). Срок был: ${t.due_date}`;
      if (t.assigned_to) await push(t.assigned_to, t.id, 'overdue', text);
      if (t.user_id && t.user_id !== t.assigned_to) await push(t.user_id, t.id, 'overdue', text);
      await db.query('UPDATE todos SET overdue_notified_at = ? WHERE id = ?', [nowStr, t.id]);
    }
  } catch (err) {
    console.error('reminders:', err.message);
  }
}

module.exports = { push, taskAssigned, taskStatus, reminders, sendMax };
