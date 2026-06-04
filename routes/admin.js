const express = require('express');
const bcrypt = require('bcrypt');
const pool = require('../db');
const { ensureRole } = require('./middleware');
const router = express.Router();

router.use(ensureRole('admin'));

router.get('/dashboard', async (req, res) => {
  const [users] = await pool.execute('SELECT id, name, email, role FROM users ORDER BY role, name');
  const [items] = await pool.execute(
    `SELECT items.*, reporter.name AS reporter_name, claimant.name AS claimant_name
     FROM items
     LEFT JOIN users AS reporter ON items.reported_by = reporter.id
     LEFT JOIN users AS claimant ON items.claimed_by = claimant.id
     ORDER BY items.created_at DESC`
  );
  res.render('admin_dashboard', { title: 'Admin Dashboard', users, items });
});

router.post('/users/create', async (req, res) => {
  const { name, email, password, role } = req.body;
  if (!name || !email || !password || !role) {
    req.flash('error', 'Please complete all fields to create a user.');
    return res.redirect('/admin/dashboard');
  }

  const [existing] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
  if (existing.length) {
    req.flash('error', 'A user with that email already exists.');
    return res.redirect('/admin/dashboard');
  }

  const passwordHash = await bcrypt.hash(password, 10);
  await pool.execute('INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
    [name, email, passwordHash, role]);
  req.flash('success', 'New user created successfully.');
  res.redirect('/admin/dashboard');
});

module.exports = router;
