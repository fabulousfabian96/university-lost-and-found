const express = require('express');
const pool = require('../db');
const { ensureRole } = require('./middleware');
const { sendMail } = require('../mailer');
const router = express.Router();

router.use(ensureRole('security'));

router.get('/dashboard', async (req, res) => {
  const [claims] = await pool.execute(
    `SELECT items.*, reporter.name AS reporter_name, claimant.name AS claimant_name, claimant.email AS claimant_email
     FROM items
     LEFT JOIN users AS reporter ON items.reported_by = reporter.id
     LEFT JOIN users AS claimant ON items.claimed_by = claimant.id
     WHERE items.claim_status = 'pending' ORDER BY items.updated_at DESC`
  );
  res.render('security_dashboard', { title: 'Security Dashboard', claims });
});

router.post('/claims/:id/approve', async (req, res) => {
  const itemId = req.params.id;
  const [items] = await pool.execute('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items.length) {
    req.flash('error', 'Item not found.');
    return res.redirect('/security/dashboard');
  }

  await pool.execute(
    `UPDATE items SET claim_status = 'approved', status = 'claimed', approved_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [req.session.user.id, itemId]
  );

  const approverEmail = items[0].claimant_email;
  const approverName = items[0].claimant_name || 'Claimant';

  await pool.execute(
    'INSERT INTO notifications (user_id, message, is_read, created_at) VALUES (?, ?, 0, NOW())',
    [items[0].claimed_by, `Your claim for "${items[0].title}" has been approved. Please collect it at the security office.`]
  );

  await sendMail(
    approverEmail,
    `Claim approved for ${items[0].title}`,
    `Hello ${approverName},\n\nGood news! Your claim for the item \"${items[0].title}\" has been approved by the Kabianga Security Office. Please visit security to collect your item.\n\nThank you,\nKabianga Security Office`,
    `<p>Hello ${approverName},</p><p>Good news! Your claim for the item <strong>${items[0].title}</strong> has been approved by the Kabianga Security Office.</p><p>Please visit security to collect your item.</p><p>Thank you,<br/>Kabianga Security Office</p>`
  );

  req.flash('success', 'Claim approved and claimer notified.');
  res.redirect('/security/dashboard');
});

router.post('/claims/:id/reject', async (req, res) => {
  const itemId = req.params.id;
  const [items] = await pool.execute('SELECT * FROM items WHERE id = ?', [itemId]);
  if (!items.length) {
    req.flash('error', 'Item not found.');
    return res.redirect('/security/dashboard');
  }

  await pool.execute(
    `UPDATE items SET claim_status = 'rejected', status = 'available', approved_by = ?, updated_at = NOW()
     WHERE id = ?`,
    [req.session.user.id, itemId]
  );

  const rejectEmail = items[0].claimant_email;
  const rejectName = items[0].claimant_name || 'Claimant';

  await pool.execute(
    'INSERT INTO notifications (user_id, message, is_read, created_at) VALUES (?, ?, 0, NOW())',
    [items[0].claimed_by, `Your claim for "${items[0].title}" has been rejected. Please contact security for assistance.`]
  );

  await sendMail(
    rejectEmail,
    `Claim rejected for ${items[0].title}`,
    `Hello ${rejectName},\n\nYour claim for the item \"${items[0].title}\" has been rejected by the Kabianga Security Office. Please contact security for assistance and next steps.\n\nThank you,\nKabianga Security Office`,
    `<p>Hello ${rejectName},</p><p>Your claim for the item <strong>${items[0].title}</strong> has been rejected by the Kabianga Security Office.</p><p>Please contact security for assistance and next steps.</p><p>Thank you,<br/>Kabianga Security Office</p>`
  );

  req.flash('success', 'Claim rejected and claimer notified.');
  res.redirect('/security/dashboard');
});

module.exports = router;
