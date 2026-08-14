const express = require('express');
const dotenv = require('dotenv');
const cors = require('cors');
const helmet = require('helmet');
const morgan = require('morgan');
const path = require('path');
const connectDB = require('./config/db');
const logger = require('./config/logger');
const errorHandler = require('./middleware/errorHandler');
const Hostel = require('./models/Hostel');

// Load environment variables
dotenv.config();

// Connect to MongoDB Database
connectDB();

const app = express();

// Security & Middleware Stack
app.use(helmet());

const corsAllowlist = [
  'https://admin.stayinhostel.com',
  'http://127.0.0.1:5173',
  'http://localhost:5173'
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin) {
      return callback(null, true);
    }
    if (corsAllowlist.includes(origin)) {
      return callback(null, true);
    }
    return callback(new Error(`CORS policy violation: origin ${origin} not allowed`));
  },
  credentials: true
}));
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// HTTP Request logging stream to Winston (disabled by default in production to avoid log flooding)
if (process.env.ENABLE_REQUEST_LOGS === 'true') {
  app.use(morgan('combined', { stream: { write: (message) => logger.info(message.trim()) } }));
} else if (process.env.NODE_ENV !== 'production') {
  app.use(morgan('dev'));
}

// Mount Admin API Routes
app.use('/api/admin', require('./routes/adminRoutes'));
app.use('/api/hostels', require('./routes/hostelRoutes'));

// API Root Route
app.get('/', (req, res) => {
  res.status(200).json({ status: 'API is running successfully', service: 'stayinhostel-admin-server' });
});

// Base Health Check Endpoint
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'UP', service: 'stayinhostel-admin-server', timestamp: new Date() });
});

// 404 Route Handler
app.use((req, res, next) => {
  res.status(404).json({ success: false, message: `Admin Route ${req.originalUrl} not found` });
});

// Global Centralized Error Handling Middleware
app.use(errorHandler);

const PORT = Number(process.env.PORT || 5000);

const deactivateExpiredHostels = async () => {
  try {
    const now = new Date();
    const expiredHostels = await Hostel.find({
      isActive: true,
      expiryDate: { $ne: null, $lte: now }
    });

    for (const hostel of expiredHostels) {
      hostel.isActive = false;
      hostel.isLive = false;
      await hostel.save();
      logger.info(`Auto-deactivated expired hostel: ${hostel.name}`);
    }
  } catch (error) {
    logger.error('Expiry check failed:', error);
  }
};

const server = app.listen(PORT, () => {
  logger.info(`StayInHostel Admin Server running on port ${PORT} in [${process.env.NODE_ENV || 'development'}] mode`);
  deactivateExpiredHostels();
  setInterval(deactivateExpiredHostels, 24 * 60 * 60 * 1000);
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    logger.error(`Port ${PORT} is already in use. Please stop the other process or change PORT in .env.`);
  } else {
    logger.error('Server startup error:', err);
  }
  process.exit(1);
});

// Handle unhandled promise rejections gracefully
process.on('unhandledRejection', (err) => {
  logger.error(`Unhandled Rejection: ${err.message}`, { stack: err.stack });
  if (server && typeof server.close === 'function') {
    server.close(() => process.exit(1));
    return;
  }
  process.exit(1);
});
