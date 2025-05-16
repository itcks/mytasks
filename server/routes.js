const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');
const config = require('./config');
const bcrypt = require('bcryptjs');

// --- Регистрация ---
router.post("/register", async (req, res) => {
  const { username, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const [result] = await db.query(
      'INSERT INTO users (username, password) VALUES (?, ?)',
      [username, hashedPassword]
    );
    res.json({ message: 'User registered', userId: result.insertId });
  } catch (err) {
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

    const token = jwt.sign({ id: user.id, username: user.username }, config.jwtSecret, { expiresIn: '1d' });
    res.json({ token });
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

// --- Роуты для задач ---
router.get('/todos', authenticateToken, async (req, res) => {
  try {
    const [rows] = await db.query('SELECT * FROM todos WHERE user_id = ?', [req.user.id]);
    res.json(rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.post('/todos', authenticateToken, async (req, res) => {
  const { text, createdAt, dueDate } = req.body;

  if (!text || !createdAt) {
    return res.status(400).json({ error: "Missing required fields" });
  }

  try {
    const [result] = await db.query(
      'INSERT INTO todos (user_id, text, created_at, due_date) VALUES (?, ?, ?, ?)',
      [req.user.id, text, createdAt, dueDate]
    );

    res.json({
      id: result.insertId,
      text,
      createdAt,
      dueDate
    });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.put('/todos/:id', authenticateToken, async (req, res) => {
  const { completed, comment, completedAt } = req.body;

  try {
    await db.query(
      'UPDATE todos SET completed = ?, comment = ?, completed_at = ? WHERE id = ? AND user_id = ?',
      [completed, comment, completedAt, req.params.id, req.user.id]
    );
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

router.delete('/todos/:id', authenticateToken, async (req, res) => {
  try {
    await db.query('DELETE FROM todos WHERE id = ? AND user_id = ?', [req.params.id, req.user.id]);
    res.json({ success: true });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
