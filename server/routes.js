const express = require('express');
const router = express.Router();
const db = require('./db');
const jwt = require('jsonwebtoken');
const config = require('./config');

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
  try {
    const [result] = await db.query(
      'INSERT INTO todos (user_id, text, created_at, due_date) VALUES (?, ?, ?, ?)',
      [req.user.id, text, createdAt, dueDate]
    );
    res.json({ id: result.insertId, text, createdAt, dueDate });
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

router.post('/register', async (req, res) => {
  const { username, password } = req.body;
  try {
    const userId = await require('./auth').register(username, password);
    res.json({ message: 'User registered', userId });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

router.post('/login', async (req, res) => {
  const { username, password } = req.body;
  try {
    const token = await require('./auth').login(username, password);
    res.json({ token });
  } catch (error) {
    res.status(400).json({ error: error.message });
  }
});

module.exports = router;