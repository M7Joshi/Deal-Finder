// backend/routes/email.js
import express from 'express';
import nodemailer from 'nodemailer';
import { composeOfferPayload } from '../services/emailService.js';

const router = express.Router();
const isDryRun = () => process.env.EMAIL_DRY_RUN === '1';

// Build transporter from environment variables (fallback)
function buildTransporterFromEnv() {
  const host = process.env.SMTP_HOST;
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = String(process.env.SMTP_SECURE || 'false') === 'true';
  const user = process.env.SMTP_USER;
  const pass = process.env.SMTP_PASS;
  if (!host || !user || !pass) return null;
  return nodemailer.createTransport({ host, port, secure, auth: { user, pass } });
}

// Build transporter from subadmin's SMTP credentials
function buildTransporterFromSubadmin(smtp) {
  if (!smtp || !smtp.host || !smtp.user || !smtp.pass) return null;
  return nodemailer.createTransport({
    host: smtp.host,
    port: Number(smtp.port || 587),
    secure: Boolean(smtp.secure),
    auth: {
      user: smtp.user,
      pass: smtp.pass,
    },
  });
}

router.post('/send-email', async (req, res) => {
  try {
    const body = req.body || {};

    // ---------- Branch 1: Generic payload ----------
    const { to, from, replyTo, subject, html, text, headers, smtp } = body;
    const looksGeneric = !!to || !!subject || !!html || !!text;

    const sendGeneric = async () => {
      if (!to || !subject || (!html && !text)) {
        return res.status(400).json({ ok: false, error: 'Missing required fields (to, subject, html|text)' });
      }
      if (isDryRun()) {
        console.log('[email:dry-run] generic', { to, subject, haveHtml: !!html, haveText: !!text });
        return res.json({ ok: true, dryRun: true, mode: 'generic' });
      }

      // Try SMTP credentials from payload first, then fallback to environment
      let transporter = null;
      let usedCustomSmtp = false;

      if (smtp) {
        transporter = buildTransporterFromSubadmin(smtp);
        if (transporter) usedCustomSmtp = true;
      }

      if (!transporter) {
        transporter = buildTransporterFromEnv();
      }

      if (!transporter) {
        return res.status(400).json({ ok: false, error: 'SMTP not configured (SMTP_HOST/SMTP_USER/SMTP_PASS)' });
      }

      const info = await transporter.sendMail({
        to,
        from: from || (smtp?.user ? `Mioym Deal Finder <${smtp.user}>` : `Mioym Deal Finder <${process.env.SMTP_USER}>`),
        replyTo,
        subject,
        html,
        text,
        headers,
      });
      return res.json({ ok: true, mode: 'generic', messageId: info.messageId, usedCustomSmtp });
    };

    if (looksGeneric) return await sendGeneric();

    // ---------- Branch 2: Offer payload ----------
    const { property, subadmin, offerPrice } = body;
    if (!property || !subadmin) {
      return res.status(400).json({ ok: false, error: 'Agent email and property details are required.' });
    }
    if (!property.agent_email || !property.fullAddress) {
      return res.status(400).json({ ok: false, error: 'property.agent_email and property.fullAddress are required.' });
    }
    if (!subadmin.email) {
      return res.status(400).json({ ok: false, error: 'subadmin.email is required.' });
    }

    const payload = await composeOfferPayload({ property, subadmin, offerPrice });

    if (isDryRun()) {
      console.log('[email:dry-run] offer', { to: payload.to, subject: payload.subject });
      return res.json({ ok: true, dryRun: true, mode: 'offer' });
    }

    // Try subadmin's SMTP first, fallback to environment SMTP
    let transporter = null;
    let usedSubadminSmtp = false;

    if (subadmin.smtp) {
      transporter = buildTransporterFromSubadmin(subadmin.smtp);
      if (transporter) {
        usedSubadminSmtp = true;
        // Override 'from' to use subadmin's SMTP email
        payload.from = `${subadmin.name || subadmin.email} <${subadmin.smtp.user || subadmin.email}>`;
      }
    }

    // Fallback to environment SMTP if subadmin SMTP not available
    if (!transporter) {
      transporter = buildTransporterFromEnv();
    }

    if (!transporter) {
      return res.status(400).json({ ok: false, error: 'SMTP not configured. Either configure subadmin SMTP or set SMTP_HOST/SMTP_USER/SMTP_PASS environment variables.' });
    }

    const info = await transporter.sendMail(payload);
    return res.json({ ok: true, mode: 'offer', messageId: info.messageId, usedSubadminSmtp });
  } catch (err) {
    console.error('[email] send failed', err);
    const detail = err?.response?.data || err?.message || 'Unknown email error';
    return res.status(400).json({ ok: false, error: detail });
  }
});

export default router;