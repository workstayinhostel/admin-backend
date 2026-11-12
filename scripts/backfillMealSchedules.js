require('dotenv').config();

const mongoose = require('mongoose');
const connectDB = require('../config/db');
const Hostel = require('../models/Hostel');
const { normalizeMealSchedule } = require('../utils/mealSchedule');

const backfillMealSchedules = async () => {
  await connectDB();

  let operations = [];
  let updatedCount = 0;

  try {
    const cursor = Hostel.find({}, { _id: 1, mealSchedule: 1 }).lean().cursor();

    for await (const hostel of cursor) {
      const mealSchedule = normalizeMealSchedule(hostel.mealSchedule);
      if (JSON.stringify(mealSchedule) === JSON.stringify(hostel.mealSchedule)) continue;

      operations.push({
        updateOne: {
          filter: { _id: hostel._id },
          update: { $set: { mealSchedule } }
        }
      });

      if (operations.length === 500) {
        const result = await Hostel.bulkWrite(operations);
        updatedCount += result.modifiedCount;
        operations = [];
      }
    }

    if (operations.length) {
      const result = await Hostel.bulkWrite(operations);
      updatedCount += result.modifiedCount;
    }

    console.log(`Meal schedules backfilled for ${updatedCount} hostel(s).`);
  } finally {
    await mongoose.disconnect();
  }
};

backfillMealSchedules().catch(error => {
  console.error('Meal schedule backfill failed:', error);
  process.exitCode = 1;
});
