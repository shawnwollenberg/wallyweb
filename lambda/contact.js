// AWS Lambda contact handler. Dependencies are injectable so tests never create a live SES client.
const nodemailer = require('nodemailer');
const aws = require('aws-sdk');

const SUCCESS_MESSAGE = 'Thank you for your message! We\'ll get back to you soon.';
const ERROR_MESSAGE = 'Something went wrong. Please try again later.';
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function headersFor(env = process.env) {
  return {
    'Access-Control-Allow-Origin': env.ALLOWED_ORIGIN || '*',
    'Access-Control-Allow-Headers': 'Content-Type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Content-Type': 'application/json',
  };
}

function response(statusCode, headers, payload) {
  return { statusCode, headers, body: payload === null ? '' : JSON.stringify(payload) };
}

function validateContact(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) return false;
  return typeof input.name === 'string' && !!input.name.trim()
    && typeof input.email === 'string' && EMAIL_RE.test(input.email)
    && typeof input.service === 'string' && !!input.service.trim()
    && typeof input.message === 'string' && !!input.message.trim();
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, char => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  })[char]);
}

function buildMailOptions(input, env = process.env) {
  const { name, email, company, service, message } = input;
  const companyHtml = company ? `\n        <p><strong>Company:</strong> ${escapeHtml(company)}</p>` : '';
  const companyText = company ? `\nCompany: ${company}` : '';
  return {
    from: env.EMAIL_FROM,
    to: env.CONTACT_EMAIL,
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
  const ses = new aws.SES({ region: env.SES_REGION || env.AWS_REGION || 'us-east-2' });
  return nodemailer.createTransport({ SES: { ses, aws } });
}

function createHandler(options = {}) {
  const env = options.env || process.env;
  const getTransporter = options.createTransporter || (() => createTransporter(env));
  return async event => {
    const headers = headersFor(env);
    const method = event && event.httpMethod;
    if (method === 'OPTIONS') return response(200, headers, null);
    if (method !== 'POST') return response(405, headers, { success: false, message: 'Method not allowed' });

    let body;
    try {
      body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
    } catch {
      return response(400, headers, { success: false, message: 'Invalid request body' });
    }
    if (!validateContact(body)) {
      return response(400, headers, { success: false, message: 'All required fields must be valid' });
    }
    try {
      await getTransporter().sendMail(buildMailOptions(body, env));
      return response(200, headers, { success: true, message: SUCCESS_MESSAGE });
    } catch (error) {
      if (options.logErrors !== false) console.error('Error processing contact form:', error);
      return response(500, headers, { success: false, message: ERROR_MESSAGE });
    }
  };
}

const handler = createHandler();
module.exports = { handler, createHandler, createTransporter, buildMailOptions, validateContact, headersFor, SUCCESS_MESSAGE, ERROR_MESSAGE };
