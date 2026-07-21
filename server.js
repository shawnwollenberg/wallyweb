const express = require('express');
const cors = require('cors');
const nodemailer = require('nodemailer');
require('dotenv').config();

const SUCCESS_MESSAGE = 'Thank you for your message! We\'ll get back to you soon.';
const ERROR_MESSAGE = 'Something went wrong. Please try again later.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateContact(input) {
  const value = input && typeof input === 'object' ? input : {};
  const errors = [];
  if (typeof value.name !== 'string' || !value.name.trim()) errors.push({ path: 'name', msg: 'Name is required' });
  if (typeof value.email !== 'string' || !EMAIL_RE.test(value.email)) errors.push({ path: 'email', msg: 'Valid email is required' });
  if (typeof value.service !== 'string' || !value.service.trim()) errors.push({ path: 'service', msg: 'Service selection is required' });
  if (typeof value.message !== 'string' || !value.message.trim()) errors.push({ path: 'message', msg: 'Message is required' });
  return errors;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function buildMailOptions(input, env = process.env) {
  const { name, email, company, service, message } = input;
  const companyHtml = company ? `\n          <p><strong>Company:</strong> ${escapeHtml(company)}</p>` : '';
  const companyText = company ? `\nCompany: ${company}` : '';
  return {
    from: env.EMAIL_FROM || env.EMAIL_USER,
    to: env.CONTACT_EMAIL || env.EMAIL_USER,
    replyTo: email,
    subject: `New Contact Form Submission - ${service}`,
    html: `<h2>New Contact Form Submission</h2>
          <p><strong>Name:</strong> ${escapeHtml(name)}</p>
          <p><strong>Email:</strong> ${escapeHtml(email)}</p>${companyHtml}
          <p><strong>Service Interest:</strong> ${escapeHtml(service)}</p>
          <p><strong>Message:</strong></p>
          <p>${escapeHtml(message).replace(/\r?\n/g, '<br>')}</p>`,
    text: `New Contact Form Submission

Name: ${name}
Email: ${email}${companyText}
Service Interest: ${service}

Message:
${message}`,
  };
}

function createTransporter(env = process.env) {
  if (env.EMAIL_SERVICE === 'gmail') {
    return nodemailer.createTransport({ service: 'gmail', auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS } });
  }
  if (env.SMTP_HOST) {
    return nodemailer.createTransport({
      host: env.SMTP_HOST, port: env.SMTP_PORT || 587, secure: env.SMTP_SECURE === 'true',
      auth: { user: env.EMAIL_USER, pass: env.EMAIL_PASS },
    });
  }
  if (env.AWS_SES_REGION) {
    return nodemailer.createTransport({
      SES: { region: env.AWS_SES_REGION, credentials: {
        accessKeyId: env.AWS_ACCESS_KEY_ID, secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
      } },
    });
  }
  return { sendMail: async options => {
    console.log('Email would be sent:', options);
    return { messageId: `test-${Date.now()}` };
  } };
}

function createApp(options = {}) {
  const env = options.env || process.env;
  const getTransporter = options.createTransporter || (() => createTransporter(env));
  const app = express();
  app.use(cors({ origin: env.ALLOWED_ORIGIN || '*' }));
  const jsonParser = express.json();
  app.use((req, res, next) => req.body === undefined ? jsonParser(req, res, next) : next());

  app.post('/api/contact', async (req, res) => {
    const errors = validateContact(req.body);
    if (errors.length) return res.status(400).json({ success: false, message: 'Validation failed', errors });
    try {
      await getTransporter().sendMail(buildMailOptions(req.body, env));
      return res.json({ success: true, message: SUCCESS_MESSAGE });
    } catch (error) {
      if (options.logErrors !== false) console.error('Error sending email:', error);
      return res.status(500).json({ success: false, message: ERROR_MESSAGE });
    }
  });
  app.all('/api/contact', (req, res) => {
    res.set('Allow', 'POST, OPTIONS');
    res.status(405).json({ success: false, message: 'Method not allowed' });
  });
  app.get('/api/health', (req, res) => res.json({ status: 'ok', timestamp: new Date().toISOString() }));
  app.use(express.static('.'));
  return app;
}

const app = createApp();

if (require.main === module) {
  const port = process.env.PORT || 3000;
  app.listen(port, () => {
    console.log(`Server running on http://localhost:${port}`);
    console.log(`Contact form endpoint: http://localhost:${port}/api/contact`);
  });
}

module.exports = { app, createApp, createTransporter, buildMailOptions, validateContact, SUCCESS_MESSAGE, ERROR_MESSAGE };
