const express = require('express');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const routes = require('./routes');

const app = express();

// Настройка CORS с параметрами
app.use(cors({
  origin: 'http://192.168.10.55', // Разрешённый источник
  methods: ['GET', 'POST', 'PUT', 'DELETE'], // Разрешённые методы
  allowedHeaders: ['Content-Type', 'Authorization'], // Разрешённые заголовки
  credentials: true // Если используешь cookies
}));

// Другие middleware
app.use(helmet());
app.use(morgan('dev'));
app.use(express.json());

// Роуты
app.use('/api', routes);

// Запуск сервера
const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Сервер запущен на http://localhost:${PORT}`);
});
