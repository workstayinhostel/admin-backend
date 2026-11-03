const express = require('express');
const landmarkController = require('../controllers/landmarkController');
const { protect, isAdminLevel } = require('../middleware/auth');
const { createResponseCache } = require('../middleware/adminResponseCache');

const router = express.Router();
const cacheLandmarkResponses = createResponseCache({
  namespace: 'landmarks',
  ttlMs: 60 * 60 * 1000
});

router.use(protect, isAdminLevel);
router.route('/')
  .get(cacheLandmarkResponses, landmarkController.getLandmarks)
  .post(landmarkController.createLandmark);
router.route('/:id')
  .get(cacheLandmarkResponses, landmarkController.getLandmarkById)
  .put(landmarkController.updateLandmark)
  .delete(landmarkController.deleteLandmark);

module.exports = router;
