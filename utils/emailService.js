const { Resend } = require('resend');
const logger = require('../config/logger');

<<<<<<< HEAD
const normalizeEnvValue = (value) => (typeof value === 'string' ? value.trim() : '');

const getResendConfig = (env = process.env) => {
  const apiKey = normalizeEnvValue(env.RESEND_API_KEY || env.RESEND_PASSWORD);
  const fromEmail = normalizeEnvValue(env.RESEND_FROM_EMAIL);
  const fromName = normalizeEnvValue(env.RESEND_FROM_NAME) || 'Stay In Hostel';
  const placeholderValues = ['your_resend_api_key', 'your_api_key', 'changeme', 'replace_me'];
  const normalizedKey = apiKey.toLowerCase();
  const hasApiKey = Boolean(apiKey) && !placeholderValues.includes(normalizedKey);
  const hasFromEmail = Boolean(fromEmail);

  return {
    apiKey,
    fromEmail: fromEmail || 'noreply@stayinhostel.com',
    fromName,
    hasValidConfig: hasApiKey && hasFromEmail,
    reason: hasApiKey ? (hasFromEmail ? null : 'missing_from_email') : 'missing_or_invalid_api_key'
  };
};

const resendConfig = getResendConfig();
const resend = resendConfig.hasValidConfig ? new Resend(resendConfig.apiKey) : null;

if (resendConfig.hasValidConfig) {
  logger.info('Resend HTTP API client initialized successfully');
} else {
  logger.warn(`Resend email service is disabled: ${resendConfig.reason === 'missing_from_email' ? 'Set RESEND_FROM_EMAIL.' : 'Set a valid RESEND_API_KEY in the environment.'}`);
=======
const apiKey = process.env.RESEND_API_KEY || process.env.RESEND_PASSWORD || '';
const resend = new Resend(apiKey);

const hasResendCredentials = Boolean(apiKey && apiKey !== 'your_resend_api_key');

if (hasResendCredentials) {
  logger.info('Resend HTTP API client initialized successfully');
} else {
  logger.warn('Resend API key is not configured correctly. Add RESEND_API_KEY and restart the server.');
>>>>>>> 0654657811e56f60ba1829cda413ee560c8034ce
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
<<<<<<< HEAD
    if (!resendConfig.hasValidConfig || !resend) {
      const reason = resendConfig.reason || 'missing_or_invalid_api_key';
      logger.warn(`Email not sent to ${to}: ${reason}`);
      return { success: false, error: 'Resend email service is not configured correctly.' };
    }

    const fromField = `${resendConfig.fromName} <${resendConfig.fromEmail}>`;
=======
    if (!hasResendCredentials) {
      throw new Error('Resend API key is missing or invalid.');
    }

    const fromEmail = process.env.RESEND_FROM_EMAIL || 'noreply@stayinhostel.com';
    const fromName = process.env.RESEND_FROM_NAME || 'Stay In Hostel';
    
    // Format "Name <email@domain.com>" properly for Resend API
    const fromField = `${fromName} <${fromEmail}>`;
>>>>>>> 0654657811e56f60ba1829cda413ee560c8034ce

    const data = await resend.emails.send({
      from: fromField,
      to: [to],
      subject,
      html
    });

    logger.info(`Email sent successfully to ${to}`, { id: data.id || data.data?.id });
    return { success: true, messageId: data.id || data.data?.id };
  } catch (error) {
<<<<<<< HEAD
    const errorMessage = error?.body?.error?.message || error?.message || 'Unknown Resend error';
    logger.error(`Failed to send email to ${to}:`, { message: errorMessage, status: error?.status });
    return { success: false, error: errorMessage, status: error?.status };
=======
    logger.error(`Failed to send email to ${to}:`, error);
    return { success: false, error: error.message };
>>>>>>> 0654657811e56f60ba1829cda413ee560c8034ce
  }
};

/**
 * Send email to multiple recipients
 * @param {array} recipients - Array of recipient emails
 * @param {string} subject - Email subject
 * @param {string} html - Email HTML content
 * @returns {Promise}
 */
const sendBulkEmail = async (recipients, subject, html) => {
  try {
    const results = await Promise.all(
      recipients.map(email => sendEmail(email, subject, html))
    );
    
    const successful = results.filter(r => r.success).length;
    logger.info(`Bulk email sent: ${successful}/${recipients.length} successful`);
    return { success: true, results };
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
  sendEmail,
  sendBulkEmail,
  sendTemplateEmail,
<<<<<<< HEAD
  getResendConfig,
=======
>>>>>>> 0654657811e56f60ba1829cda413ee560c8034ce
  transporter: null // Kept as null for backwards compatibility in case other files reference it
};