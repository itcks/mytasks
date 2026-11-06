const express = require('express');
const path = require('path');
const cors = require('cors');
const helmet = require('helmet');
const routes = require('./routes');
const db = require('./db');
const bcrypt = require('bcryptjs');
const notify = require('./notify');

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

// Раздача статики клиента
app.use(express.static(path.join(__dirname, '..', 'client')));

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
const PORT = process.env.PORT || 3000;
process.on('uncaughtException', err => console.error('uncaught:', err.message));
process.on('unhandledRejection', err => console.error('unhandled:', err));
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
  seedUsers();
});
