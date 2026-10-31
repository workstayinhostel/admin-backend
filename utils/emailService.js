const nodemailer = require('nodemailer');
const logger = require('../config/logger');

const normalizeEnvValue = (value) => (typeof value === 'string' ? value.trim() : '');

const getResendConfig = (env = process.env) => {
  const apiKey = normalizeEnvValue(env.RESEND_API_KEY || env.RESEND_PASSWORD);
  const fromEmail = normalizeEnvValue(env.RESEND_FROM_EMAIL) || 'no-reply@admin.stayinhostel.com';
  const fromName = normalizeEnvValue(env.RESEND_FROM_NAME) || 'SIH ADMIN';
  const host = normalizeEnvValue(env.RESEND_HOST) || 'smtp.resend.com';
  const configuredPort = normalizeEnvValue(env.RESEND_PORT) || '587';
  const port = Number(configuredPort);
  const placeholderValues = ['your_resend_api_key', 'your_api_key', 'changeme', 'replace_me'];
  const normalizedKey = apiKey.toLowerCase();
  const hasApiKey = Boolean(apiKey) && !placeholderValues.includes(normalizedKey);
  const hasValidSmtpConfig = Boolean(host) && Number.isInteger(port) && port > 0 && port <= 65535;

  return {
    apiKey,
    fromEmail,
    fromName,
    host,
    port,
    secure: port === 465,
    hasValidConfig: hasApiKey && Boolean(fromEmail) && hasValidSmtpConfig,
    reason: !hasApiKey
      ? 'missing_or_invalid_api_key'
      : !fromEmail
        ? 'missing_from_email'
        : !hasValidSmtpConfig
          ? 'invalid_smtp_config'
          : null
  };
};

const resendConfig = getResendConfig();
const transporter = resendConfig.hasValidConfig
  ? nodemailer.createTransport({
      host: resendConfig.host,
      port: resendConfig.port,
      secure: resendConfig.secure,
      requireTLS: !resendConfig.secure,
      auth: {
        user: 'resend',
        pass: resendConfig.apiKey
      }
    })
  : null;

if (resendConfig.hasValidConfig) {
  logger.info('Resend SMTP transport initialized successfully');
} else {
  const configurationHint = {
    missing_from_email: 'Set RESEND_FROM_EMAIL.',
    invalid_smtp_config: 'Set a valid RESEND_HOST and RESEND_PORT.',
    missing_or_invalid_api_key: 'Set a valid RESEND_API_KEY in the environment.'
  };
  logger.warn(`Resend email service is disabled: ${configurationHint[resendConfig.reason]}`);
}

/**
 * Send email
 * @param {string} to - Recipient email
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @returns {Promise}
 */
const sendEmail = async (to, subject, html) => {
  try {
    if (!resendConfig.hasValidConfig || !transporter) {
      const reason = resendConfig.reason || 'missing_or_invalid_api_key';
      logger.warn(`Email not sent to ${to}: ${reason}`);
      return { success: false, error: 'Resend email service is not configured correctly.' };
    }

    const fromField = `${resendConfig.fromName} <${resendConfig.fromEmail}>`;

    const info = await transporter.sendMail({
      from: fromField,
      to,
      subject,
      html
    });

    logger.info(`Email sent successfully to ${to}`, { id: info.messageId });
    return { success: true, messageId: info.messageId };
  } catch (error) {
    const errorMessage = error?.message || 'Unknown Resend SMTP error';
    logger.error(`Failed to send email to ${to}:`, { message: errorMessage, status: error?.responseCode });
    return { success: false, error: errorMessage, status: error?.responseCode };
  }
};

/**
 * Send email to multiple recipients
 * @param {array} recipients - Array of recipient emails
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @returns {Promise}
 */
const sendBulkEmail = async (recipients, template) => {
  try {
    if (!Array.isArray(recipients) || !template?.subject || !template?.html) {
      return { success: false, error: 'Recipients and a valid email template are required.' };
    }

    const results = await Promise.all(
      recipients.map(email => sendTemplateEmail(email, template))
    );

    const successful = results.filter(r => r.success).length;
    logger.info(`Bulk email sent: ${successful}/${recipients.length} successful`);
    return { success: successful === results.length, results };
  } catch (error) {
    logger.error('Bulk email error:', error);
    return { success: false, error: error.message };
  }
};

/**
 * Send email with template
 * @param {string} to - Recipient email
 * @param {object} template - Template object with subject and html
 * @returns {Promise}
 */
const sendTemplateEmail = async (to, template) => {
  return sendEmail(to, template.subject, template.html);
};

module.exports = {
  sendBulkEmail,
  sendTemplateEmail,
  getResendConfig,
  transporter
};