const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const router = express.Router();

router.get('/login', (req, res) => {
  res.render('login', { title: 'Login' });
});

router.get('/register', (req, res) => {
  res.render('register', { title: 'Register' });
});

router.post('/register', async (req, res) => {
  const { name, email, password, passwordConfirm } = req.body;
  if (!name || !email || !password || password !== passwordConfirm) {
    req.flash('error', 'Please fill in all fields and confirm password correctly.');
    return res.redirect('/register');
  }

  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) {
    req.flash('error', 'An account with this email already exists.');
    return res.redirect('/register');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.execute(
    'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, 'user']
  );

  req.flash('success', 'Registration successful. You can now log in.');
  res.redirect('/login');
});

router.post('/login', async (req, res) => {
  const { email, password } = req.body;
  if (!email || !password) {
    req.flash('error', 'Email and password are required.');
    return res.redirect('/login');
  }

  const [rows] = await pool.execute('SELECT * FROM users WHERE email = ?', [email]);
  const user = rows[0];
  if (!user) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/login');
  }

  const isMatch = await bcrypt.compare(password, user.password_hash);
  if (!isMatch) {
    req.flash('error', 'Invalid credentials.');
    return res.redirect('/login');
  }

  req.session.user = {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
  };

  if (user.role === 'admin') return res.redirect('/admin/dashboard');
  if (user.role === 'security') return res.redirect('/security/dashboard');
  return res.redirect('/items/dashboard');
});

router.get('/logout', (req, res) => {
  req.session.destroy(() => {
    res.redirect('/login');
  });
});

module.exports = router;
