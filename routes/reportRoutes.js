const express = require('express');
const reportController = require('../controllers/reportController');
const { protect, isAdminLevel, checkPasswordChange } = require('../middleware/auth');

const router = express.Router();

router.use(protect, checkPasswordChange, isAdminLevel);
router.post('/pdf', reportController.generatePdf);

module.exports = router;