const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');
const db = require('./db');
const bcrypt = require('bcryptjs');
const notify = require('./notify');
const bot = require('./bot');

// Создание учётных записей по умолчанию, если их нет
async function seedUsers() {
  const defaults = [
    { username: 'admin', password: 'admin123', role: 'admin' },
    { username: 'engineer', password: 'engineer123', role: 'engineer' }
  ];
  for (const u of defaults) {
    try {
      const [rows] = await db.query('SELECT id FROM users WHERE username = ?', [u.username]);
      if (!rows.length) {
        const hashed = await bcrypt.hash(u.password, 10);
        await db.query(
          'INSERT INTO users (username, password, role) VALUES (?, ?, ?)',
          [u.username, hashed, u.role]
        );
        console.log(`Создан пользователь по умолчанию: ${u.username} / ${u.password} (${u.role})`);
      }
    } catch (err) {
      console.error('Ошибка сидинга пользователей:', err.message);
    }
  }
}

const app = express();

// Приложение работает за reverse-proxy (nginx/Apache) с HTTPS
app.set('trust proxy', 1);

// Раздача статики клиента
app.use(express.static(path.join(__dirname, '..', 'client'), {
  maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0
}));

// Настройка CORS с параметрами
app.use(cors({
  origin: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE'],
  allowedHeaders: ['Content-Type', 'Authorization', 'X-Bot-Key'],
  credentials: true
}));

// Другие middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '12mb' }));

// Напоминания о сроках и просрочках — раз в минуту
setInterval(() => notify.reminders(), 60 * 1000);

// Роуты
app.use('/api', routes);

// Запуск сервера
// Запуск сервера.
// В production (NODE_ENV=production) слушаем только localhost —
// наружу приложение отдаёт reverse-proxy (nginx/Apache) с HTTPS.
const PORT = process.env.PORT || 3000;
const HOST = process.env.NODE_ENV === 'production' ? '127.0.0.1' : '0.0.0.0';

process.on('uncaughtException', err => console.error('uncaught:', err.message));
process.on('unhandledRejection', err => console.error('unhandled:', err));
app.listen(PORT, HOST, () => {
  console.log(`Сервер запущен на http://${HOST}:${PORT}`);
  seedUsers();
  bot.start();
});
