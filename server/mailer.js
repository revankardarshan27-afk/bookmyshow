const nodemailer = require('nodemailer');

const transporter = process.env.SMTP_HOST
  ? nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: Number(process.env.SMTP_PORT || 587),
      secure: Number(process.env.SMTP_PORT) === 465,
      auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS },
    })
  : null;

// Never throws: a failed email must not break a booking.
exports.sendMail = async (to, subject, text) => {
  if (!transporter) {
    console.log(`[email skipped - SMTP not set] To: ${to} | ${subject}`);
    return;
  }
  try {
    await transporter.sendMail({ from: process.env.SMTP_FROM || process.env.SMTP_USER, to, subject, text });
    console.log('Email sent to', to);
  } catch (e) {
    console.log('Email failed:', e.message);
  }
};
