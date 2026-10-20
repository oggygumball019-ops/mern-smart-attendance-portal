const express = require('express');
const router = express.Router();
const Attendance = require('../models/Attendance');
const Student = require('../models/Student');

// GET: Fetch Today's Attendance Logs
router.get('/today', async (req, res) => {
  try {
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const logs = await Attendance.find({
      date: { $gte: startOfDay,$lte: endOfDay }
    }).sort({ timestamp: -1 });

    res.json(logs);
  } catch (err) {
    console.error("Fetch Today's Logs Error:", err);
    res.status(500).json({ error: "Failed to fetch attendance logs." });
  }
});

// GET: Fetch Dashboard Stats
// GET /api/attendance/stats
router.get('/stats', async (req, res) => {
  try {
    // 1. Get real total registered count from Student collection
    const totalRegistered = await Student.countDocuments();

    // 2. Define today's time window (00:00:00 to 23:59:59)
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    // 3. Count unique students present today
    const presentToday = await Attendance.countDocuments({
      timestamp: { $gte: startOfDay, $lte: endOfDay }
    });

    // 4. Calculate attendance percentage safely (cap max at 100%)
    const attendanceRate = totalRegistered > 0 
      ? Math.min(100, Math.round((presentToday / totalRegistered) * 100)) 
      : 0;

    res.json({
      totalRegistered,
      presentToday,
      attendanceRate
    });
  } catch (error) {
    console.error("Error fetching stats:", error);
    res.status(500).json({ error: "Server error fetching attendance stats" });
  }
});

// POST: Mark Attendance
router.post('/mark', async (req, res) => {
  try {
    // Handle either faceEmbedding or faceDescriptor from payload
    const { faceEmbedding, faceDescriptor } = req.body;
    const liveVector = faceEmbedding || faceDescriptor;

    if (!liveVector || !Array.isArray(liveVector)) {
      return res.status(400).json({ message: "Invalid face embedding data received." });
    }

    const students = await Student.find();
    if (!students || students.length === 0) {
      return res.status(404).json({ message: "No registered students found in database." });
    }

    let bestMatch = null;
    let minDistance = 1.2; // Matching threshold

    for (const student of students) {
      // Support both faceDescriptor and faceEmbedding field names in MongoDB
      const dbVector = student.faceDescriptor || student.faceEmbedding;

      if (!dbVector || dbVector.length === 0) {
        console.log(`⚠️ Student ${student.name} (${student.rollNo}) has no face vector stored.`);
        continue;
      }

      // Calculate Euclidean distance
      const dist = Math.sqrt(
        liveVector.reduce((sum, val, idx) => sum + Math.pow(val - (dbVector[idx] || 0), 2), 0)
      );

      console.log(`🔍 Comparing with ${student.name}: Calculated Distance = ${dist.toFixed(4)}`);

      if (dist < minDistance) {
        minDistance = dist;
        bestMatch = student;
      }
    }

    if (!bestMatch) {
      return res.status(400).json({ message: "Face not recognized. Please try again or re-register." });
    }

    // Check for existing mark today
    const startOfDay = new Date();
    startOfDay.setHours(0, 0, 0, 0);

    const endOfDay = new Date();
    endOfDay.setHours(23, 59, 59, 999);

    const existingAttendance = await Attendance.findOne({
      studentId: bestMatch._id,
      date: { $gte: startOfDay,$lte: endOfDay }
    });

    if (existingAttendance) {
      return res.status(400).json({ 
        message: `Attendance already marked for ${bestMatch.name} (${bestMatch.rollNo}) today!` 
      });
    }

    // Save attendance passing required schema attributes
    const newAttendance = new Attendance({
      studentId: bestMatch._id,
      name: bestMatch.name,
      rollNo: bestMatch.rollNo,
      status: 'Present',
      confidence: 'N/A',
      date: new Date(),
      timestamp: new Date()
    });

    await newAttendance.save();

    return res.status(201).json({
      message: `Attendance marked successfully for ${bestMatch.name}!`,
      attendance: newAttendance
    });

  } catch (err) {
    console.error("Mark Attendance Route Error:", err);
    return res.status(500).json({ error: err.message || "Failed to mark attendance." });
  }
});

module.exports = router;