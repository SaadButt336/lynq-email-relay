const express = require('express');
const nodemailer = require('nodemailer');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// ── Auth middleware — simple API key check ──────────────────
app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) {
    return res.status(401).json({ error: 'Unauthorized' });
  }
  next();
});

// ── Health check ────────────────────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'Lynq Email Relay' });
});

// ── Create transporter from env vars ───────────────────────
function getTransporter() {
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port: parseInt(process.env.SMTP_PORT) || 587,
    secure: false,
    auth: {
      user: process.env.SMTP_USER,
      pass: process.env.SMTP_PASS,
    },
    tls: { rejectUnauthorized: false }
  });
}

// ── Send single email ───────────────────────────────────────
app.post('/send', async (req, res) => {
  const { to, subject, html, text, replyTo, fromName } = req.body;
  if (!to || !subject || (!html && !text)) {
    return res.status(400).json({ error: 'Missing required fields: to, subject, html/text' });
  }
  try {
    const transporter = getTransporter();
    const name = fromName || process.env.FROM_NAME || 'Lynq Logistics';
    const from = `"${name}" <${process.env.SMTP_USER}>`;
    await transporter.sendMail({
      from,
      to,
      subject,
      html: html || `<p>${text}</p>`,
      text: text || html?.replace(/<[^>]*>/g,''),
      replyTo: replyTo || process.env.SMTP_USER,
    });
    console.log(`✓ Sent to ${to} — ${subject}`);
    res.json({ success: true, to, subject });
  } catch (err) {
    console.error(`✗ Failed to ${to}:`, err.message);
    res.status(500).json({ error: err.message });
  }
});

// ── Send bulk emails ────────────────────────────────────────
app.post('/send-bulk', async (req, res) => {
  const { emails, fromName } = req.body;
  if (!Array.isArray(emails) || emails.length === 0) {
    return res.status(400).json({ error: 'emails array required' });
  }
  const transporter = getTransporter();
  const name = fromName || process.env.FROM_NAME || 'Lynq Logistics';
  const from = `"${name}" <${process.env.SMTP_USER}>`;
  const results = [];
  for (const email of emails) {
    try {
      await transporter.sendMail({
        from,
        to: email.to,
        subject: email.subject,
        html: email.html || `<p>${email.text || ''}</p>`,
        text: email.text || email.html?.replace(/<[^>]*>/g,''),
        replyTo: process.env.SMTP_USER,
      });
      results.push({ to: email.to, status: 'sent' });
      console.log(`✓ Sent to ${email.to}`);
      // Small delay between emails to avoid rate limiting
      await new Promise(r => setTimeout(r, 300));
    } catch (err) {
      results.push({ to: email.to, status: 'failed', error: err.message });
      console.error(`✗ Failed to ${email.to}:`, err.message);
    }
  }
  const sent = results.filter(r => r.status === 'sent').length;
  const failed = results.filter(r => r.status === 'failed').length;
  res.json({ success: true, sent, failed, results });
});

// ── Test connection ─────────────────────────────────────────
app.post('/test', async (req, res) => {
  try {
    const transporter = getTransporter();
    await transporter.verify();
    res.json({ success: true, message: 'SMTP connection verified ✓', user: process.env.SMTP_USER });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => console.log(`Lynq Email Relay running on port ${PORT}`));
