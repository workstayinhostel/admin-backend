const express = require('express');
const userAdminController = require('../controllers/userAdminController');
const { protect, isAdminLevel, checkPasswordChange } = require('../middleware/auth');

const router = express.Router();

router.post('/create-stream', protect, checkPasswordChange, isAdminLevel, userAdminController.createUserAccountStream);

module.exports = router;