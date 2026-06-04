const express = require('express');
const multer = require('multer');
const path = require('path');
const pool = require('../db');
const { sendMail } = require('../mailer');
const router = express.Router();

const storage = multer.diskStorage({
  destination: (req, file, cb) => cb(null, path.join(__dirname, '..', 'public', 'uploads')),
  filename: (req, file, cb) => cb(null, `${Date.now()}-${file.originalname}`),
});
const upload = multer({ storage, limits: { fileSize: 2 * 1024 * 1024 } });

router.get('/dashboard', async (req, res) => {
  const [items] = await pool.execute(
    `SELECT items.*, users.name AS reporter, claim_users.name AS claimant
     FROM items
     LEFT JOIN users ON items.reported_by = users.id
     LEFT JOIN users AS claim_users ON items.claimed_by = claim_users.id
     WHERE items.status = 'available' OR items.claim_status = 'rejected'`
  );

  const [notifications] = await pool.execute(
    'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 10',
    [req.session.user.id]
  );

  res.render('dashboard', { title: 'Lost & Found Dashboard', items, notifications });
});

router.get('/new', (req, res) => {
  res.render('item_new', { title: 'Report Lost Item' });
});

router.post('/new', upload.single('image'), async (req, res) => {
  const { title, description } = req.body;
  if (!title || !description) {
    req.flash('error', 'Title and description are required.');
    return res.redirect('/items/new');
  }

  const imagePath = req.file ? `/uploads/${req.file.filename}` : null;
  await pool.execute(
    `INSERT INTO items (title, description, image_path, status, reported_by, claim_status, created_at, updated_at)
     VALUES (?, ?, ?, 'available', ?, 'unclaimed', NOW(), NOW())`,
    [title, description, imagePath, req.session.user.id]
  );

  req.flash('success', 'Your lost item report has been submitted to the security office.');
  res.redirect('/items/dashboard');
});

router.get('/claim/:id', async (req, res) => {
  const [rows] = await pool.execute('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!rows.length) {
    req.flash('error', 'Item not found.');
    return res.redirect('/items/dashboard');
  }
  res.render('item_claim', { title: 'Claim Item', item: rows[0] });
});

router.post('/claim/:id', async (req, res) => {
  const { claimantName, claimantContact } = req.body;
  if (!claimantName || !claimantContact) {
    req.flash('error', 'Please provide your name and contact information.');
    return res.redirect(`/items/claim/${req.params.id}`);
  }

  const [itemRows] = await pool.execute('SELECT * FROM items WHERE id = ?', [req.params.id]);
  if (!itemRows.length || itemRows[0].status !== 'available') {
    req.flash('error', 'Item cannot be claimed at this time.');
    return res.redirect('/items/dashboard');
  }

  await pool.execute(
    `UPDATE items SET claimed_by = ?, claim_status = 'pending', claim_message = ?, updated_at = NOW() WHERE id = ?`,
    [req.session.user.id, `Contact: ${claimantContact}`, req.params.id]
  );

  await pool.execute(
    'INSERT INTO notifications (user_id, message, is_read, created_at) VALUES (?, ?, 0, NOW())',
    [req.session.user.id, 'Your claim request has been submitted and is awaiting security approval.']
  );

  await sendMail(
    req.session.user.email,
    `Claim request received for ${itemRows[0].title}`,
    `Hello ${req.session.user.name},\n\nYour claim for the item \"${itemRows[0].title}\" has been submitted and is pending security approval. We will notify you once the claim is verified.\n\nThank you,\nKabianga Lost & Found Office`,
    `<p>Hello ${req.session.user.name},</p><p>Your claim for the item <strong>${itemRows[0].title}</strong> has been submitted and is pending security approval.</p><p>We will notify you once the claim is verified.</p><p>Thank you,<br/>Kabianga Lost & Found Office</p>`
  );

  req.flash('success', 'Claim request submitted. Security will approve or reject the claim.');
  res.redirect('/items/dashboard');
});

router.get('/my-items', async (req, res) => {
  const [items] = await pool.execute(
    `SELECT items.*, reporter.name AS reporter_name, claimant.name AS claimant_name
     FROM items
     LEFT JOIN users AS reporter ON items.reported_by = reporter.id
     LEFT JOIN users AS claimant ON items.claimed_by = claimant.id
     WHERE items.reported_by = ? OR items.claimed_by = ?
     ORDER BY items.created_at DESC`,
    [req.session.user.id, req.session.user.id]
  );
  res.render('my_items', { title: 'My Reports & Claims', items });
});

module.exports = router;
