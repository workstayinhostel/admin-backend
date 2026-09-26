const Subscriber = require('../models/Subscriber');
const SupportMessage = require('../models/SupportMessage');
const SubmittedHostel = require('../models/SubmittedHostel');
const { sendBulkEmail, sendTemplateEmail } = require('../utils/emailService');
const emailTemplates = require('../utils/emailTemplates');
const { createAuditLog } = require('../utils/adminHelpers');

const emailPattern = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/i;
const cleanSubject = (value) => String(value || '').replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 150);
const getMessage = (value) => typeof value === 'string' ? value.trim() : '';

const validateContent = (title, message) => {
  if (!title || !message) return 'title and message are required';
  if (title.length > 150) return 'title must be 150 characters or fewer';
  if (message.length > 10000) return 'message must be 10000 characters or fewer';
  return null;
};

const logEmailAction = (req, action, resourceType, resourceId, description) => createAuditLog({
  user: req.user._id,
  userRole: req.user.role,
  action,
  resourceType,
  resourceId,
  description,
  ipAddress: req.ip,
  userAgent: req.get('user-agent')
});

exports.sendMarketingEmail = async (req, res) => {
  try {
    const title = cleanSubject(req.body.title);
    const message = getMessage(req.body.message);
    const validationError = validateContent(title, message);
    if (validationError) return res.status(400).json({ success: false, message: validationError });

    const subscriberIds = Array.isArray(req.body.subscriberIds) ? req.body.subscriberIds : [];
    if (subscriberIds.length && req.body.allSubscribers) {
      return res.status(400).json({ success: false, message: 'Choose selected subscribers or all subscribers, not both.' });
    }
    if (subscriberIds.length > 5000) {
      return res.status(400).json({ success: false, message: 'A maximum of 5000 subscribers can be selected.' });
    }
    if (!subscriberIds.length && req.body.allSubscribers !== true) {
      return res.status(400).json({ success: false, message: 'Select subscriberIds or set allSubscribers to true.' });
    }

    const subscribers = await Subscriber.find(subscriberIds.length ? { _id: { $in: subscriberIds } } : {}).select('email').lean();
    const recipients = [...new Set(subscribers.map(({ email }) => String(email || '').trim().toLowerCase()).filter((email) => emailPattern.test(email)))];
    if (!recipients.length) return res.status(404).json({ success: false, message: 'No valid subscriber email addresses found.' });

    const emailTemplate = emailTemplates.marketingMessage(title, message, req.body.actionUrl, req.body.actionText);
    const result = await sendBulkEmail(recipients, emailTemplate);
    await logEmailAction(req, 'marketing_email_sent', 'subscriber', null, `Marketing email sent to ${result.results?.filter((item) => item.success).length || 0} subscribers`);
    return res.status(result.success ? 200 : 502).json({
      success: result.success,
      message: `Marketing email sent to ${result.results?.filter((item) => item.success).length || 0} of ${recipients.length} subscribers.`,
      total: recipients.length,
      successful: result.results?.filter((item) => item.success).length || 0,
      failed: result.results?.filter((item) => !item.success).length || recipients.length
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Error sending marketing email' });
  }
};

exports.sendSupportReply = async (req, res) => {
  try {
    const { supportMessageId } = req.params;
    const ticket = await SupportMessage.findById(supportMessageId);
    if (!ticket) return res.status(404).json({ success: false, message: 'Support message not found' });

    const title = cleanSubject(req.body.title || `Re: ${ticket.topic}`);
    const message = getMessage(req.body.message);
    const validationError = validateContent(title, message);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    if (!emailPattern.test(ticket.email)) return res.status(400).json({ success: false, message: 'Support ticket has no valid recipient email.' });

    const result = await sendTemplateEmail(ticket.email, emailTemplates.supportReply(
      ticket.name, title, message, req.body.actionUrl, req.body.actionText
    ));
    if (!result.success) return res.status(502).json({ success: false, message: 'Support reply could not be sent', error: result.error });

    await logEmailAction(req, 'support_reply_sent', 'supportMessage', ticket._id, `Sent support reply to ${ticket.email}`);
    return res.json({ success: true, message: 'Support reply sent successfully', data: { supportMessageId: ticket._id, recipient: ticket.email } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Error sending support reply' });
  }
};

exports.sendSubmissionMessage = async (req, res) => {
  try {
    const submission = await SubmittedHostel.findById(req.params.id);
    if (!submission) return res.status(404).json({ success: false, message: 'Hostel submission not found' });

    const title = cleanSubject(req.body.title);
    const message = getMessage(req.body.message);
    const validationError = validateContent(title, message);
    if (validationError) return res.status(400).json({ success: false, message: validationError });
    if (!emailPattern.test(submission.listerEmail)) return res.status(400).json({ success: false, message: 'Submission has no valid submitter email.' });

    const result = await sendTemplateEmail(submission.listerEmail, emailTemplates.customMessage(
      title, message, req.body.actionUrl, req.body.actionText
    ));
    if (!result.success) return res.status(502).json({ success: false, message: 'Submission message could not be sent', error: result.error });

    await logEmailAction(req, 'submission_message_sent', 'submittedHostel', submission._id, `Sent submission message to ${submission.listerEmail}`);
    return res.json({ success: true, message: 'Submission message sent successfully', data: { submissionId: submission._id, recipient: submission.listerEmail } });
  } catch (error) {
    return res.status(500).json({ success: false, message: error.message || 'Error sending submission message' });
  }
};