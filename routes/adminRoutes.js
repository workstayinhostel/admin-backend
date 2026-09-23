const express = require('express');
const authController = require('../controllers/authController');
const hostelAdminController = require('../controllers/hostelAdminController');
const userAdminController = require('../controllers/userAdminController');
const dashboardController = require('../controllers/dashboardController');
const adminDataController = require('../controllers/adminDataController');
const analyticsDashboardController = require('../controllers/analyticsDashboardController');
const { protect, authorize, isAdminLevel, isFounder, checkPasswordChange } = require('../middleware/auth');

const { loginLimiter, forgotPasswordLimiter, resetPasswordLimiter } = require('../middleware/rateLimiter');
const router = express.Router();

// ==========================================
// Public-facing Admin Auth & OTP Routes (No 'protect' middleware needed here)
// ==========================================
router.post('/login', loginLimiter, authController.adminLogin);
router.post('/forgot-password', forgotPasswordLimiter, authController.forgotPassword);
router.post('/verify-otp', authController.verifyOtp);
router.post('/reset-password', resetPasswordLimiter, authController.resetPassword);
router.post('/reset-password/:token', resetPasswordLimiter, authController.resetPassword);

// ==========================================
// Protected Administrative Routes (Require valid token and admin-level permissions)
// ==========================================
router.use(protect);

// Allow password change even when forcePasswordChange is set
router.post('/change-password', authController.changePassword);
router.use(checkPasswordChange);

// Create admin (founder and superadmin only)
router.post('/create-admin', authorize('founder', 'superadmin'), authController.createAdmin);
router.post('/create-user', isAdminLevel, userAdminController.createUserAccount);
router.get('/users', isAdminLevel, userAdminController.getUsers);
router.put('/users/:userId', isAdminLevel, userAdminController.updateUser);
router.get('/users/:userId', isAdminLevel, userAdminController.getUser);
router.patch('/users/:userId', isAdminLevel, userAdminController.updateUserProfile);
router.patch('/users/:userId/role', isAdminLevel, userAdminController.changeUserRole);
router.patch('/users/:userId/active', isAdminLevel, userAdminController.setUserActive);
router.post('/users/:userId/force-password-reset', isAdminLevel, userAdminController.forcePasswordReset);

// Shared public-backend collections
router.get('/submitted-hostels', isAdminLevel, adminDataController.listSubmissions);
router.get('/submitted-hostels/:id', isAdminLevel, adminDataController.getSubmission);
router.post('/submitted-hostels/:id/approve', isAdminLevel, adminDataController.approveSubmission);
router.post('/submitted-hostels/:id/reject', isAdminLevel, adminDataController.rejectSubmission);
router.get('/subscribers/export', authorize('admin', 'superadmin', 'founder'), adminDataController.exportSubscribers);
router.get('/subscribers', isAdminLevel, adminDataController.listSubscribers);
router.get('/subscribers/:id', isAdminLevel, adminDataController.getSubscriber);
router.delete('/subscribers/:id', authorize('superadmin', 'founder'), adminDataController.deleteSubscriber);
router.get('/support-messages', isAdminLevel, adminDataController.listSupportMessages);
router.get('/support-messages/:id', isAdminLevel, adminDataController.getSupportMessage);
router.patch('/support-messages/:id/status', isAdminLevel, adminDataController.updateSupportStatus);
router.delete('/support-messages/:id', authorize('superadmin', 'founder'), adminDataController.deleteSupportMessage);
router.get('/bookings', isAdminLevel, adminDataController.listBookings);
router.get('/analytics-dashboard', isAdminLevel, analyticsDashboardController.getAnalyticsDashboard);
router.get('/visits/summary', isAdminLevel, adminDataController.getVisitSummary);
router.get('/visits', isAdminLevel, adminDataController.listVisits);
router.get('/visits/:id', isAdminLevel, adminDataController.getVisit);
router.delete('/visits/:id', authorize('superadmin', 'founder'), adminDataController.deleteVisit);

// Hostel verification and management
router.post('/verify-hostel/:hostelId', isAdminLevel, hostelAdminController.verifyHostel);
router.post('/hostels/:hostelId/verify', isAdminLevel, hostelAdminController.verifyHostel);
router.post('/hostels/:hostelId/reject', isAdminLevel, hostelAdminController.rejectHostel);
router.get('/pending-hostels', isAdminLevel, hostelAdminController.getHostels);
router.post('/create-hostel', isAdminLevel, hostelAdminController.createHostel);
router.get('/hostels', isAdminLevel, hostelAdminController.getHostels);
router.get('/hostels/:hostelId', isAdminLevel, hostelAdminController.getHostelById);
router.put('/hostels/:hostelId', isAdminLevel, hostelAdminController.updateHostel);
router.put('/hostels/:hostelId/seats', isAdminLevel, hostelAdminController.updateHostelSeats);
router.post('/hostels/:hostelId/reviews', hostelAdminController.createReview);
router.get('/hostels/:hostelId/reviews', hostelAdminController.getHostelReviews);
router.post('/hostels/merge', isAdminLevel, hostelAdminController.mergeHostels);
router.get('/hostels/:hostelId/bookings', isAdminLevel, hostelAdminController.getHostelBookings);
router.get('/hostels/:hostelId/bookings/stats', isAdminLevel, hostelAdminController.getHostelBookingStats);
router.put('/hostels/:hostelId/activate', isAdminLevel, hostelAdminController.activateHostel);
router.put('/hostels/:hostelId/deactivate', isAdminLevel, hostelAdminController.deactivateHostel);
router.put('/hostels/:hostelId/set-expiry', isAdminLevel, hostelAdminController.setHostelExpiry);
router.post('/hostels/:hostelId/change-owner', isAdminLevel, hostelAdminController.changeHostelOwner);
router.post('/users/:userId/associate-hostel', isAdminLevel, hostelAdminController.associateHostelToUser);
router.get('/users/:userId/hostels', isAdminLevel, hostelAdminController.getUserHostels);
router.post('/hostels/bulk-update', isAdminLevel, hostelAdminController.bulkUpdateHostels);
router.delete('/hostels/:hostelId', isAdminLevel, hostelAdminController.deleteHostel);
router.post('/validate-link', isAdminLevel, hostelAdminController.validateUserHostelLink);

// User management
router.delete('/users/:userId', isAdminLevel, userAdminController.deleteUser);
router.put('/deactivate-user/:userId', isAdminLevel, userAdminController.deactivateUser);
router.put('/activate-user/:userId', isAdminLevel, userAdminController.activateUser);
router.post('/merge-student', isAdminLevel, hostelAdminController.assignHostelOwner);
router.post('/assign-hostel-owner', isAdminLevel, hostelAdminController.assignHostelOwner);
router.post('/hostel-owner/preview', isAdminLevel, hostelAdminController.previewHostelOwnerMerge);
router.post('/hostel-owner/merge', isAdminLevel, hostelAdminController.confirmHostelOwnerMerge);
router.post('/hostel-owner/demerge/preview', isAdminLevel, hostelAdminController.previewHostelOwnerDemerge);
router.post('/hostel-owner/demerge', isAdminLevel, hostelAdminController.demergeHostelOwner);
router.get('/lookup-user', isAdminLevel, hostelAdminController.lookupUserByEmail);

// System logs and stats
router.get('/logs', isAdminLevel, dashboardController.getLogs);
router.get('/stats', isAdminLevel, dashboardController.getDashboardStats);

module.exports = router;