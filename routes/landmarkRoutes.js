const express = require('express');
const landmarkController = require('../controllers/landmarkController');
const { protect, isAdminLevel } = require('../middleware/auth');

const router = express.Router();

router.use(protect, isAdminLevel);
router.route('/')
  .get(landmarkController.getLandmarks)
  .post(landmarkController.createLandmark);
router.route('/:id')
  .get(landmarkController.getLandmarkById)
  .put(landmarkController.updateLandmark)
  .delete(landmarkController.deleteLandmark);

module.exports = router;
