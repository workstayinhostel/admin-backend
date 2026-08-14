const express = require('express');
const hostelAdminController = require('../controllers/hostelAdminController');
const { protect, isAdminLevel } = require('../middleware/auth');
const multer = require('multer');

// 1. Import your multer configuration (adjust path as needed to where your multer middleware/config lives)
const storage = multer.memoryStorage();
const upload = multer({ 
  storage: storage,
  limits: { fileSize: 5 * 1024 * 1024 } // 5MB limit
});

const router = express.Router();

// 2. Add upload.array('images', 5) into the middleware chain
router.post('/upload-images', protect, isAdminLevel, upload.array('images', 5), hostelAdminController.uploadHostelImages);

router.post('/create', protect, isAdminLevel, hostelAdminController.createHostel);
router.get('/', protect, isAdminLevel, hostelAdminController.getHostels);
router.get('/:hostelId', protect, isAdminLevel, hostelAdminController.getHostelById);
router.put('/:hostelId', protect, isAdminLevel, hostelAdminController.updateHostel);
router.delete('/:hostelId', protect, isAdminLevel, hostelAdminController.deleteHostel);

module.exports = router;