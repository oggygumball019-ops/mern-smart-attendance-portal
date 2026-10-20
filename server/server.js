const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const jwt = require('jsonwebtoken');

const app = express();
const PORT = process.env.PORT || 5000;
const JWT_SECRET = process.env.JWT_SECRET || 'supersecretkey123';

// -----------------------------------------------------------------------------
// MIDDLEWARE
// -----------------------------------------------------------------------------
app.use(cors());
app.use(express.json({ limit: '50mb' }));

// -----------------------------------------------------------------------------
// MONGODB CONNECTION
// -----------------------------------------------------------------------------
const MONGO_URI = process.env.MONGO_URI || 'mongodb://127.0.0.1:27017/face_attendance';

mongoose.connect(MONGO_URI)
  .then(() => console.log('MongoDB Connected to face_attendance'))
  .catch(err => console.error('MongoDB Connection Error:', err));

// -----------------------------------------------------------------------------
// MONGOOSE SCHEMAS & MODELS
// -----------------------------------------------------------------------------

// Student Schema (Stores 128-d vector embeddings)
const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  rollNo: { type: String, required: true, unique: true },
  role: { type: String, enum: ['student', 'faculty', 'admin'], default: 'student' },
  faceDescriptor: { type: [Number], required: true },
  createdAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);

// Attendance Schema (Stores daily check-in logs)
const attendanceSchema = new mongoose.Schema({
  studentId: { type: mongoose.Schema.Types.ObjectId, ref: 'Student' },
  name: { type: String, required: true },
  rollNo: { type: String, required: true },
  status: { type: String, default: 'Present' },
  confidence: { type: String, default: 'Verified' },
  timestamp: { type: Date, default: Date.now }
}, { timestamps: true });

const Attendance = mongoose.model('Attendance', attendanceSchema);

// Class Session Schema (Optional ERP Context)
const sessionSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  facultyId: { type: String, default: 'FAC001' },
  startTime: { type: Date, default: Date.now },
  isActive: { type: Boolean, default: true }
});

const Session = mongoose.model('Session', sessionSchema);

// -----------------------------------------------------------------------------
// AUTH MIDDLEWARE
// -----------------------------------------------------------------------------
const authenticateToken = (req, res, next) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return next(); // Soft bypass for local development/demos

  jwt.verify(token, JWT_SECRET, (err, user) => {
    if (err) return res.status(403).json({ message: 'Invalid or expired token' });
    req.user = user;
    next();
  });
};

// -----------------------------------------------------------------------------
// REST API ROUTES
// -----------------------------------------------------------------------------

// 1. AUTH LOGIN ROUTE
app.post('/api/auth/login', async (req, res) => {
  try {
    const { rollNo, role } = req.body;
    const token = jwt.sign({ rollNo, role: role || 'admin' }, JWT_SECRET, { expiresIn: '8h' });
    res.json({ success: true, token, role: role || 'admin' });
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 2. ENROLL / REGISTER STUDENT (Saves 128-d Vector)
app.post('/api/students/register', authenticateToken, async (req, res) => {
  try {
    const { name, rollNo, faceDescriptor, faceEmbedding } = req.body;
    const descriptor = faceDescriptor || faceEmbedding;

    if (!name || !rollNo || !descriptor) {
      return res.status(400).json({ message: 'Missing required fields or face descriptor' });
    }

    // Check if student with this Roll Number already exists
    const existingStudent = await Student.findOne({ rollNo: rollNo.trim() });
    if (existingStudent) {
      return res.status(400).json({ message: 'Student with this Roll Number already exists' });
    }

    const newStudent = new Student({
      name: name.trim(),
      rollNo: rollNo.trim(),
      faceDescriptor: descriptor
    });

    await newStudent.save();

    res.status(201).json({
      success: true,
      message: `Student ${name} registered successfully!`,
      student: newStudent
    });
  } catch (err) {
    console.error('Registration Error:', err);
    res.status(500).json({ message: err.message });
  }
});

// 3. GET ENROLLED DESCRIPTORS FOR CLIENT-SIDE COMPARISON
app.get('/api/students/descriptors', authenticateToken, async (req, res) => {
  try {
    const students = await Student.find({}, 'name rollNo faceDescriptor');
    res.json(students);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 4. MARK ATTENDANCE
app.post('/api/attendance/mark', authenticateToken, async (req, res) => {
  try {
    const { rollNo, studentId } = req.body;

    if (!rollNo) {
      return res.status(400).json({ message: 'Roll number is required' });
    }

    const student = await Student.findOne({ rollNo: rollNo.trim() });
    if (!student) {
      return res.status(404).json({ message: 'Student record not found' });
    }

    // Daily Duplication Check (Start of Day to End of Day)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const existingLog = await Attendance.findOne({
      rollNo: student.rollNo,
      timestamp: { $gte: startOfDay }
    });

    if (existingLog) {
      return res.status(400).json({
        message: `Attendance already marked today for ${student.name}!`
      });
    }

    const now = new Date();

    // Create New Verification Entry with explicit date field
    const attendance = new Attendance({
      studentId: student._id || studentId,
      name: student.name,
      rollNo: student.rollNo,
      status: 'Present',
      confidence: 'Verified',
      date: now,
      timestamp: now
    });

    await attendance.save();

    res.status(200).json({
      success: true,
      message: `Attendance marked successfully for ${student.name}!`,
      attendance
    });
  } catch (err) {
    console.error('Attendance Error:', err);
    res.status(500).json({ message: err.message });
  }
});
// 5. GET TODAY'S ATTENDANCE LOGS
app.get('/api/attendance/today', authenticateToken, async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const logs = await Attendance.find({ timestamp: { $gte: startOfDay } }).sort({ timestamp: -1 });
    res.json(logs);
  } catch (err) {
    res.status(500).json({ error: err.message });
  }
});

// 6. GET ANALYTICS METRICS (AGGREGATION PIPELINE)
app.get('/api/attendance/stats', authenticateToken, async (req, res) => {
  try {
    const totalRegistered = await Student.countDocuments();

    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    // MongoDB Aggregation for unique daily check-ins
    const attendanceToday = await Attendance.aggregate([
      { $match: { timestamp: {$gte: startOfDay } } },
      { $group: { _id: "$rollNo" } },
      { $count: "presentToday" }
    ]);

    const presentToday = attendanceToday.length > 0 ? attendanceToday[0].presentToday : 0;
    const attendanceRate = totalRegistered > 0 ? Math.round((presentToday / totalRegistered) * 100) : 0;

    res.json({
      totalRegistered,
      presentToday,
      attendanceRate
    });
  } catch (err) {
    console.error('Stats Error:', err);
    res.status(500).json({ error: err.message });
  }
});

// -----------------------------------------------------------------------------
// START EXPRESS SERVER
// -----------------------------------------------------------------------------
app.listen(PORT, () => {
  console.log(`Server running on http://localhost:${PORT}`);
});