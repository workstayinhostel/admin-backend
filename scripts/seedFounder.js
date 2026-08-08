const dotenv = require('dotenv');
dotenv.config();

const mongoose = require('mongoose');
const User = require('../models/User');

const email = 'work.stayinhostel@gmail.com';
const password = 'stayinhostel00@@123';

async function seedFounder() {
  try {
    if (!process.env.MONGODB_URI) {
      throw new Error('MONGODB_URI is missing in .env');
    }

    await mongoose.connect(process.env.MONGODB_URI);

    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) {
      console.log('Founder already exists:');
      console.log({
        id: existing._id,
        email: existing.email,
        role: existing.role,
        isActive: existing.isActive
      });
      process.exit(0);
    }

    const founder = await User.create({
      firstName: 'Stay',
      lastName: 'In Hostel',
      email: email.toLowerCase(),
      phone: '9999999999',
      password,
      role: 'founder',
      isVerified: true,
      isActive: true,
      forcePasswordChange: false
    });

    console.log('Founder created successfully');
    console.log({
      id: founder._id,
      email: founder.email,
      role: founder.role,
      password: password
    });

    process.exit(0);
  } catch (error) {
    console.error('Seed founder failed:', error.message);
    process.exit(1);
  }
}

seedFounder();
