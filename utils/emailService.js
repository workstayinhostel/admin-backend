const { Resend } = require('resend');
const logger = require('../config/logger');

const normalizeEnvValue = (value) => (typeof value === 'string' ? value.trim() : '');

const getResendConfig = (env = process.env) => {
  const apiKey = normalizeEnvValue(env.RESEND_API_KEY || env.RESEND_PASSWORD);
  const fromEmail = normalizeEnvValue(env.RESEND_FROM_EMAIL) || 'no-reply@administrator.stayinhostel.com';
  const fromName = normalizeEnvValue(env.RESEND_FROM_NAME) || 'SIH ADMIN';
  const placeholderValues = ['your_resend_api_key', 'your_api_key', 'changeme', 'replace_me'];
  const normalizedKey = apiKey.toLowerCase();
  const hasApiKey = Boolean(apiKey) && !placeholderValues.includes(normalizedKey);

  return {
    apiKey,
    fromEmail,
    fromName,
    hasValidConfig: hasApiKey && Boolean(fromEmail),
    reason: !hasApiKey ? 'missing_or_invalid_api_key' : !fromEmail ? 'missing_from_email' : null
  };
};

const resendConfig = getResendConfig();
const resend = resendConfig.hasValidConfig ? new Resend(resendConfig.apiKey) : null;

if (resendConfig.hasValidConfig) {
  logger.info(`Resend HTTP API client configured for ${resendConfig.fromEmail}`);
} else {
  const configurationHint = resendConfig.reason === 'missing_from_email'
    ? 'Set RESEND_FROM_EMAIL.'
    : 'Set a valid RESEND_API_KEY in the environment.';
  logger.warn(`Resend email service is disabled: ${configurationHint}`);
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
    if (!resendConfig.hasValidConfig || !resend) {
      const reason = resendConfig.reason || 'missing_or_invalid_api_key';
      logger.warn(`Email not sent to ${to}: ${reason}`);
      return { success: false, error: 'Resend email service is not configured correctly.' };
    }

    const fromField = `${resendConfig.fromName} <${resendConfig.fromEmail}>`;

    const result = await resend.emails.send({
      from: fromField,
      to: [to],
      subject,
      html
    });

    if (result.error) {
      const errorMessage = result.error.message || 'Resend rejected the email.';
      logger.error(`Failed to send email to ${to}:`, {
        message: errorMessage,
        status: result.error.statusCode
      });
      return { success: false, error: errorMessage, status: result.error.statusCode };
    }

    if (!result.data?.id) {
      logger.error(`Resend returned no message ID for email to ${to}.`);
      return { success: false, error: 'Resend did not confirm the email was accepted.' };
    }

    logger.info(`Email accepted by Resend for ${to}`, { id: result.data.id });
    return { success: true, messageId: result.data.id };
  } catch (error) {
    const errorMessage = error?.message || 'Unknown Resend API error';
    logger.error(`Failed to send email to ${to}:`, { message: errorMessage, status: error?.statusCode });
    return { success: false, error: errorMessage, status: error?.statusCode };
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
  resend
};