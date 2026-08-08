const emailTemplates = {
  // User Registration Verification
  emailVerification: (userName, verificationLink) => ({
    subject: 'Verify Your Email - Stay In Hostel',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Welcome to Stay In Hostel!</h2>
        <p>Hi ${userName},</p>
        <p>Thank you for registering with us. Please verify your email address by clicking the button below:</p>
        <a href="${verificationLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Verify Email
        </a>
        <p>This link will expire in 24 hours.</p>
        <p>If you didn't create this account, please ignore this email.</p>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Password Reset
  passwordReset: (userName, resetLink) => ({
    subject: 'Reset Your Password - Stay In Hostel',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f7fb; border-radius: 10px; border: 1px solid #e0e0e0;">
        <h2 style="color: #1a202c;">Password Reset Request</h2>
        <p>Hi ${userName},</p>
        <p>We received a request to reset your password. Use the button below to set a new password:</p>
        <a href="${resetLink}" style="background-color: #2196F3; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; display: inline-block; margin: 16px 0;">
          Reset Password
        </a>
        <p style="margin: 0;">This link will expire in 1 hour.</p>
        <p>If you didn't request this password reset, no action is required and your account will remain secure.</p>
        <p style="margin: 16px 0 0 0;">Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  adminOtpEmail: (userName, otp, purpose) => ({
    subject: purpose === 'admin-password-reset'
      ? 'Your Admin Password Reset OTP - Stay In Hostel'
      : 'Your Admin Verification OTP - Stay In Hostel',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px; background: #f5f7fb; border-radius: 10px; border: 1px solid #e0e0e0;">
        <h2 style="color: #1a202c;">${purpose === 'admin-password-reset' ? 'Password Reset Code' : 'Verification Code'}</h2>
        <p>Hi ${userName},</p>
        <p>Your ${purpose === 'admin-password-reset' ? 'password reset' : 'verification'} code is:</p>
        <div style="font-size: 22px; letter-spacing: 4px; font-weight: 700; margin: 20px 0; padding: 18px 12px; background: #ffffff; border: 1px solid #d1d5db; text-align: center; border-radius: 8px;">
          ${otp}
        </div>
        <p style="margin: 0;">This code expires in 10 minutes.</p>
        <p>If you did not request this, please ignore this email.</p>
        <p style="margin: 16px 0 0 0;">Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Admin Account Creation
  adminAccountCreated: (userName, email, tempPassword, role) => ({
    subject: 'Your Admin Account Has Been Created - Stay In Hostel',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Admin Account Created</h2>
        <p>Hi ${userName},</p>
        <p>A new ${role} account has been created for you on Stay In Hostel platform.</p>
        <p><strong>Login Credentials:</strong></p>
        <ul>
          <li>Email: ${email}</li>
          <li>Temporary Password: ${tempPassword}</li>
          <li>Role: ${role}</li>
        </ul>
        <p>For security reasons, you will be asked to change your password on first login.</p>
<<<<<<< HEAD
        <a href="${process.env.ADMIN_CLIENT_URL}/login" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
=======
        <a href="${process.env.CLIENT_URL}/admin/login" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
>>>>>>> 0654657811e56f60ba1829cda413ee560c8034ce
          Login to Admin Panel
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Booking Request Notification
  bookingRequestToOwner: (hostelName, studentName, studentPhone, checkIn, checkOut, roomType) => ({
    subject: `New Booking Request for ${hostelName} - Stay In Hostel`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>New Booking Request</h2>
        <p>You have received a new booking request for your hostel.</p>
        <p><strong>Hostel:</strong> ${hostelName}</p>
        <p><strong>Student Name:</strong> ${studentName}</p>
        <p><strong>Student Phone:</strong> ${studentPhone}</p>
        <p><strong>Room Type:</strong> ${roomType}</p>
        <p><strong>Check-in Date:</strong> ${checkIn}</p>
        <p><strong>Check-out Date:</strong> ${checkOut}</p>
        <p>Please respond to the booking request as soon as possible.</p>
        <a href="${process.env.CLIENT_URL}/owner/bookings" style="background-color: #FF9800; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          View Booking Details
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Booking Confirmation
  bookingConfirmed: (studentName, hostelName, confirmationCode, checkIn, checkOut) => ({
    subject: `Booking Confirmed for ${hostelName} - Stay In Hostel`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Booking Confirmed!</h2>
        <p>Hi ${studentName},</p>
        <p>Your booking has been confirmed by the hostel owner.</p>
        <p><strong>Hostel:</strong> ${hostelName}</p>
        <p><strong>Confirmation Code:</strong> ${confirmationCode}</p>
        <p><strong>Check-in Date:</strong> ${checkIn}</p>
        <p><strong>Check-out Date:</strong> ${checkOut}</p>
        <p>The hostel owner will contact you shortly with more details.</p>
        <a href="${process.env.CLIENT_URL}/my-bookings" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          View My Bookings
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Hostel Verification
  hostelVerified: (ownerName, hostelName, hostelCode) => ({
    subject: `Your Hostel Has Been Verified - Stay In Hostel`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hostel Verified!</h2>
        <p>Hi ${ownerName},</p>
        <p>Congratulations! Your hostel "${hostelName}" has been verified and is now live on our platform.</p>
        <p><strong>Hostel Code:</strong> ${hostelCode}</p>
        <p>Students can now see and book rooms at your hostel.</p>
        <a href="${process.env.CLIENT_URL}/owner/dashboard" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Go to Dashboard
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Hostel Rejection
  hostelRejected: (ownerName, hostelName, reason) => ({
    subject: `Hostel Verification Status - Stay In Hostel`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Hostel Verification Update</h2>
        <p>Hi ${ownerName},</p>
        <p>Your hostel listing "${hostelName}" could not be verified at this time.</p>
        <p><strong>Reason:</strong></p>
        <p>${reason}</p>
        <p>Please address the issues and resubmit your hostel for verification.</p>
        <a href="${process.env.CLIENT_URL}/owner/hostels" style="background-color: #2196F3; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Update Hostel Details
        </a>
        <p>For any queries, please contact our support team.</p>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Rating Request
  ratingRequest: (studentName, hostelName, bookingCode) => ({
    subject: `Rate Your Stay at ${hostelName} - Stay In Hostel`,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Share Your Experience</h2>
        <p>Hi ${studentName},</p>
        <p>Thank you for staying at ${hostelName}. We'd love to hear about your experience!</p>
        <p>Your feedback helps other students make better choices and helps the hostel improve.</p>
        <a href="${process.env.CLIENT_URL}/rate-hostel/${bookingCode}" style="background-color: #FF9800; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Rate Your Stay
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // Account Deactivation Warning
  accountWarning: (userName) => ({
    subject: 'Account Status Warning - Stay In Hostel',
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>Account Status Warning</h2>
        <p>Hi ${userName},</p>
        <p>We have detected unusual activity on your account. If this was not you, please secure your account immediately.</p>
        <a href="${process.env.CLIENT_URL}/security" style="background-color: #F44336; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">
          Secure My Account
        </a>
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  }),

  // General Notification
  notification: (title, message, actionLink, actionText) => ({
    subject: title,
    html: `
      <div style="font-family: Arial, sans-serif; max-width: 600px; margin: 0 auto;">
        <h2>${title}</h2>
        <p>${message}</p>
        ${actionLink ? `<a href="${actionLink}" style="background-color: #4CAF50; color: white; padding: 10px 20px; text-decoration: none; border-radius: 5px; display: inline-block;">${actionText || 'View Details'}</a>` : ''}
        <p>Best regards,<br/>Stay In Hostel Team</p>
      </div>
    `
  })
};

module.exports = emailTemplates;
