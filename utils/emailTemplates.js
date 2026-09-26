const theme = {
  brand: 'STAY IN HOSTEL',
  colors: {
    primary: '#17273D',
    accent: '#7C8C41',
    text: '#17273D',
    muted: '#65727c',
    background: '#F7F3E8'
  }
};

const escapeHtml = (value) => String(value ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;')
  .replace(/'/g, '&#039;');

const safeActionUrl = (value) => {
  if (!value) return '';
  try {
    const url = new URL(String(value));
    return ['http:', 'https:'].includes(url.protocol) ? url.toString() : '';
  } catch {
    return '';
  }
};

const urls = {
  auth: process.env.AUTH_CLIENT_URL || 'https://auth.stayinhostel.com',
  marketing: process.env.MARKETING_CLIENT_URL || 'https://stayinhostel.com',
  app: process.env.APP_CLIENT_URL || 'https://app.stayinhostel.com',
  dashboard: process.env.DASHBOARD_CLIENT_URL || 'https://dashboard.stayinhostel.com',
  admindashboard: process.env.ADMIN_DASHBOARD_CLIENT_URL || 'https://admin.stayinhostel.com'
};

const layout = (title, content, actionLink, actionText) => {
  const href = safeActionUrl(actionLink);
  return `
    <div style="background:${theme.colors.background};padding:32px 16px;font-family:'Quicksand','Segoe UI',sans-serif;color:${theme.colors.text}">
      <div style="max-width:600px;margin:0 auto;background:#FFFFFF;border-top:5px solid ${theme.colors.primary};padding:28px;border-radius:12px;box-shadow:0 4px 14px rgba(13,25,38,0.08)">
        <h1 style="font-family:'Playfair Display',Georgia,serif;color:${theme.colors.primary};font-size:22px;margin:0 0 16px;text-transform:uppercase;letter-spacing:0.02em">${escapeHtml(theme.brand)}</h1>
        <h2 style="font-family:'Playfair Display',Georgia,serif;font-size:18px;margin:0 0 16px;color:${theme.colors.text};text-transform:uppercase">${escapeHtml(title)}</h2>
        <div style="font-size:15px;line-height:1.6;color:${theme.colors.text}">${content}</div>
        ${href ? `<p style="margin-top:24px"><a href="${escapeHtml(href)}" style="background:${theme.colors.accent};color:#FFFFFF;padding:12px 22px;text-decoration:none;display:inline-block;border-radius:999px;font-weight:600;font-size:14px">${escapeHtml(actionText || 'View details')}</a></p>` : ''}
        <p style="color:${theme.colors.muted};margin-top:28px;font-size:14px;border-top:1px solid rgba(23,39,61,0.1);padding-top:16px">Best regards,<br>The <b>${escapeHtml(theme.brand)}</b> Team</p>
      </div>
    </div>`;
};

const paragraph = (value) => `<p>${escapeHtml(value)}</p>`;
const messageParagraphs = (value) => String(value ?? '').split(/\r?\n/).map(escapeHtml).join('<br>');
const template = (subject, title, content, actionLink, actionText) => ({
  subject: String(subject ?? '').replace(/[\r\n\u0000-\u001f]/g, ' ').trim().slice(0, 200),
  html: layout(title, content, actionLink, actionText)
});

const roleLabels = {
  agent: 'Support Agent',
  admin: 'Admin',
  superadmin: 'Super Admin',
  founder: 'Founder',
  hostelowner: 'Hostel Owner',
  student: 'User'
};

const emailTemplates = {
  emailVerification: (userName, verificationLink) => template(
    'Verify Your Email - Stay In Hostel', 'Verify Your Email',
    `${paragraph(`Hi ${userName},`)}${paragraph('Thank you for creating a Stay In Hostel account. Verify your email address to continue.')}${paragraph('This link expires in 24 hours. If you did not create this account, you can ignore this email.')}`,
    verificationLink, 'Verify email'
  ),

  passwordReset: (userName, resetLink) => template(
    'Reset Your Password - Stay In Hostel', 'Password Reset',
    `${paragraph(`Hi ${userName},`)}${paragraph('Use the button below to set a new password. This link expires in one hour. If you did not request a reset, no action is needed.')}`,
    resetLink, 'Reset password'
  ),

  adminOtpEmail: (userName, otp, purpose) => {
    const isReset = purpose === 'admin-password-reset';
    return template(
      isReset ? 'Password Reset Code - Stay In Hostel' : 'Verification Code - Stay In Hostel',
      isReset ? 'Password Reset Code' : 'Verification Code',
      `${paragraph(`Hi ${userName},`)}${paragraph(`Your ${isReset ? 'password reset' : 'verification'} code is:`)}<p style="font-size:22px;letter-spacing:4px;font-weight:700;margin:20px 0;padding:18px 12px;background:#fff;border:1px solid #d1d5db;text-align:center;border-radius:8px">${escapeHtml(otp)}</p>${paragraph('This code expires in 10 minutes. If you did not request this, ignore this email.')}`,
      urls.auth, 'Continue to sign in'
    );
  },

  adminAccountCreated: (userName, email, tempPassword, role) => {
    const roleKey = String(role || '').toLowerCase().replace(/[\s_-]/g, '');
    const roleLabel = roleLabels[roleKey] || String(role || 'User');
    const accountUrl = roleKey === 'hostelowner' ? urls.auth : urls.admindashboard;
    return template(
      `Your ${roleLabel} Account Has Been Created - Stay In Hostel`,
      `${roleLabel} Account Created`,
      `${paragraph(`Hi ${userName},`)}${paragraph(`Your ${roleLabel} account has been created on Stay In Hostel.`)}<p><b>Account details</b></p><ul><li>Email: ${escapeHtml(email)}</li><li>Temporary password: ${escapeHtml(tempPassword)}</li><li>Account type: ${escapeHtml(roleLabel)}</li></ul>${paragraph('For security, you will be asked to change your password after signing in.')}`,
      accountUrl, 'Open your dashboard'
    );
  },

  bookingRequestToOwner: (hostelName, studentName, studentPhone, checkIn, checkOut, roomType) => template(
    `New Booking Request for ${hostelName} - Stay In Hostel`, 'New Booking Request',
    `<p>You have received a booking request for <b>${escapeHtml(hostelName)}</b>.</p><ul><li>Student: ${escapeHtml(studentName)}</li><li>Phone: ${escapeHtml(studentPhone)}</li><li>Room: ${escapeHtml(roomType)}</li><li>Check-in: ${escapeHtml(checkIn)}</li><li>Check-out: ${escapeHtml(checkOut)}</li></ul>${paragraph('Please review and respond to the request.')}`,
    `${urls.dashboard}/bookings`, 'View bookings'
  ),

  bookingConfirmed: (studentName, hostelName, confirmationCode, checkIn, checkOut) => template(
    `Booking Confirmed for ${hostelName} - Stay In Hostel`, 'Booking Confirmed',
    `${paragraph(`Hi ${studentName},`)}${paragraph('Your booking has been confirmed by the hostel owner.')}<ul><li>Hostel: ${escapeHtml(hostelName)}</li><li>Confirmation code: ${escapeHtml(confirmationCode)}</li><li>Check-in: ${escapeHtml(checkIn)}</li><li>Check-out: ${escapeHtml(checkOut)}</li></ul>${paragraph('The hostel owner will contact you with further details.')}`,
    `${urls.app}/bookings`, 'View my bookings'
  ),

  hostelVerified: (ownerName, hostelName, hostelAddress) => template(
    'Your Hostel Has Been Verified - Stay In Hostel', 'Hostel Verified',
    `${paragraph(`Hi ${ownerName},`)}${paragraph(`Your hostel, ${hostelName}, has been approved and is now live on Stay In Hostel.`)}<p><b>Address:</b> ${escapeHtml(hostelAddress || 'Address not provided')}</p>${paragraph('Students can now view and book rooms at your hostel.')}`,
    `${urls.dashboard}/hostels`, 'Open dashboard'
  ),

  hostelRejected: (ownerName, hostelName, reason) => template(
    'Hostel Verification Update - Stay In Hostel', 'Hostel Verification Update',
    `${paragraph(`Hi ${ownerName},`)}${paragraph(`Your hostel listing, ${hostelName}, could not be verified at this time.`)}<p><b>Reason:</b></p><p>${messageParagraphs(reason)}</p>${paragraph('Please address the issue and update your hostel details.')}`,
    `${urls.dashboard}/hostels`, 'Update hostel details'
  ),

  ratingRequest: (studentName, hostelName, bookingCode) => template(
    `Rate Your Stay at ${hostelName} - Stay In Hostel`, 'Share Your Experience',
    `${paragraph(`Hi ${studentName},`)}${paragraph(`Thank you for staying at ${hostelName}. Your feedback helps other students and the hostel team.`)}`,
    `${urls.app}/rate-hostel/${encodeURIComponent(String(bookingCode ?? ''))}`, 'Rate your stay'
  ),

  accountWarning: (userName) => template(
    'Account Security Notice - Stay In Hostel', 'Account Security Notice',
    `${paragraph(`Hi ${userName},`)}${paragraph('We detected activity that may need your attention. If this was not you, secure your account immediately.')}`,
    `${urls.auth}/security`, 'Secure my account'
  ),

  notification: (title, message, actionLink, actionText) => template(
    title, title, `<p>${messageParagraphs(message)}</p>`, actionLink || urls.app, actionText || 'Open Stay In Hostel'
  ),

  hostelOwnerMerged: (userName, email, hostelName, hostelCode) => template(
    `Your Account Has Been Linked to ${hostelName} - Stay In Hostel`, 'Hostel Owner Account Linked',
    `${paragraph(`Hi ${userName || 'there'},`)}${paragraph(`Your account with email ${email} has been merged with ${hostelName} (hostel code: ${hostelCode}).`)}${paragraph('You can now manage this hostel, view bookings, and use the hostel management controls in your dashboard.')}`,
    `${urls.dashboard}/hostels/${encodeURIComponent(String(hostelCode ?? ''))}`, 'Manage this hostel'
  ),

  submissionApproved: (listerEmail, hostelName, hostelAddress) => template(
    'Your Hostel Submission Is Approved - Stay In Hostel', 'Hostel Submission Approved',
    `${paragraph(`Hi ${listerEmail},`)}${paragraph(`Your hostel submission for ${hostelName} has been approved.`)}<p><b>Address:</b> ${escapeHtml(hostelAddress || 'Address not provided')}</p>${paragraph('Our team will follow up with any next steps before the hostel appears publicly. Thank you for helping us improve our listings.')}`,
    `${urls.marketing}/hostels`, 'View Stay In Hostel'
  ),

  submissionRejected: (listerEmail, hostelName, reason) => template(
    'Update About Your Hostel Submission - Stay In Hostel', 'Hostel Submission Update',
    `${paragraph(`Hi ${listerEmail},`)}${paragraph(`We could not add your submission for ${hostelName} at this time.`)}<p><b>Message:</b></p><p>${messageParagraphs(reason || 'Please contact our team for more information.')}</p>${paragraph('You may update the details and submit the hostel again.')}`,
    `${urls.marketing}/submit-hostel`, 'Submit hostel details'
  ),

  customMessage: (title, message, actionLink, actionText) => template(
    title, title, `<p>${messageParagraphs(message)}</p>`, actionLink || `${urls.marketing}/submit-hostel`, actionText || 'Visit Stay In Hostel'
  ),

  marketingMessage: (title, message, actionLink, actionText) => template(
    title, title, `<p>${messageParagraphs(message)}</p>`, actionLink || urls.marketing, actionText || 'Visit Stay In Hostel'
  ),

  supportReply: (recipientName, title, message, actionLink, actionText) => template(
    title || 'A message from Stay In Hostel Support', 'Support',
    `${paragraph(`Hi ${recipientName || 'there'},`)}<p>${messageParagraphs(message)}</p>`,
    actionLink || urls.app, actionText || 'Open Stay In Hostel'
  ),

  theme,
  urls,
  escapeHtml,
};

module.exports = emailTemplates;
