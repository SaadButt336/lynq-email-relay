const express = require('express');
const nodemailer = require('nodemailer');
const { ImapFlow } = require('imapflow');
const cors = require('cors');

const app = express();
app.use(cors());
app.use(express.json({ limit: '10mb' }));

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  const key = req.headers['x-api-key'];
  if (!key || key !== process.env.API_KEY) return res.status(401).json({ error: 'Unauthorized' });
  next();
});

app.get('/health', (req, res) => res.json({ status: 'ok' }));

function getTransporter() {
  const port = parseInt(process.env.SMTP_PORT) || 465;
  const secure = port === 465; // true for 465, false for 587
  return nodemailer.createTransport({
    host: process.env.SMTP_HOST || 'smtp.hostinger.com',
    port,
    secure,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    connectionTimeout: 30000,
    greetingTimeout: 15000,
    tls: { rejectUnauthorized: false }
  });
}

async function saveToSent(from, to, subject, html) {
  const client = new ImapFlow({
    host: process.env.IMAP_HOST || 'imap.hostinger.com',
    port: 993,
    secure: true,
    auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    logger: false,
    tls: { rejectUnauthorized: false }
  });
  try {
    await client.connect();
    const rawMsg = [`From: ${from}`,`To: ${to}`,`Subject: ${subject}`,`Date: ${new Date().toUTCString()}`,`MIME-Version: 1.0`,`Content-Type: text/html; charset=utf-8`,``,html].join('\r\n');
    for (const folder of ['Sent','INBOX.Sent','Sent Items','Sent Messages']) {
      try { await client.append(folder, Buffer.from(rawMsg), ['\\Seen']); break; } catch(e){}
    }
    await client.logout();
  } catch(e) { console.error('IMAP:', e.message); }
}

app.post('/send', async (req, res) => {
  const { to, subject, html, text, fromName } = req.body;
  if (!to || !subject) return res.status(400).json({ error: 'Missing fields' });
  try {
    const name = fromName || process.env.FROM_NAME || 'Lynq Logistics';
    const from = `"${name}" <${process.env.SMTP_USER}>`;
    const body = html || `<p>${text||''}</p>`;
    await getTransporter().sendMail({ from, to, subject, html: body, text: (text||body).replace(/<[^>]*>/g,''), replyTo: process.env.SMTP_USER });
    await saveToSent(from, to, subject, body);
    console.log(`✓ Sent: ${to}`);
    res.json({ success: true });
  } catch(e) {
    console.error(`✗ ${to}: ${e.message}`);
    res.status(500).json({ error: e.message });
  }
});

app.post('/send-bulk', async (req, res) => {
  const { emails, fromName } = req.body;
  if (!Array.isArray(emails)) return res.status(400).json({ error: 'emails array required' });
  const name = fromName || process.env.FROM_NAME || 'Lynq Logistics';
  const from = `"${name}" <${process.env.SMTP_USER}>`;
  const transporter = getTransporter();
  const results = [];
  for (const email of emails) {
    try {
      const body = email.html || `<p>${email.text||''}</p>`;
      await transporter.sendMail({ from, to: email.to, subject: email.subject, html: body, text: (email.text||body).replace(/<[^>]*>/g,''), replyTo: process.env.SMTP_USER });
      await saveToSent(from, email.to, email.subject, body);
      results.push({ to: email.to, status: 'sent' });
      console.log(`✓ Sent: ${email.to}`);
      await new Promise(r => setTimeout(r, 300));
    } catch(e) {
      results.push({ to: email.to, status: 'failed', error: e.message });
      console.error(`✗ ${email.to}: ${e.message}`);
    }
  }
  const sent = results.filter(r => r.status==='sent').length;
  const failed = results.filter(r => r.status==='failed').length;
  res.json({ success: true, sent, failed, results });
});

app.post('/test', async (req, res) => {
  const errors = [];
  try { await getTransporter().verify(); } catch(e) { errors.push('SMTP: '+e.message); }
  const imap = new ImapFlow({ host:'imap.hostinger.com', port:993, secure:true, auth:{user:process.env.SMTP_USER, pass:process.env.SMTP_PASS}, logger:false, tls:{rejectUnauthorized:false} });
  try { await imap.connect(); await imap.logout(); } catch(e) { errors.push('IMAP: '+e.message); }
  if (errors.length) return res.status(500).json({ error: errors.join(' | ') });
  res.json({ success: true, message: 'SMTP + IMAP connected ✓', user: process.env.SMTP_USER });
});

app.listen(process.env.PORT || 3000, () => console.log('Lynq Email Relay running'));
