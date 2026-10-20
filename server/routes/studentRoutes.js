const express = require('express');
const router = express.Router();
const Student = require('../models/Student'); // Adjust path if your model is elsewhere

// POST /api/students/register
router.post('/register', async (req, res) => {
  try {
    const { name, rollNo, faceEmbedding } = req.body;

    // 1. Validation check
    if (!name || !rollNo || !faceEmbedding) {
      return res.status(400).json({ 
        message: "Missing required fields: Name, Roll Number, or Face Scan failed." 
      });
    }

    // 2. Duplicate roll number check
    const existingStudent = await Student.findOne({ rollNo });
    if (existingStudent) {
      return res.status(400).json({ 
        message: `Student with Roll Number ${rollNo} is already registered.` 
      });
    }

    // 3. Save new student
    const student = new Student({ name, rollNo, faceEmbedding });
    await student.save();

    res.status(201).json({ 
      message: `Student ${name} registered successfully!`, 
      student 
    });

  } catch (err) {
    console.error("Registration Error:", err);
    res.status(500).json({ message: "Server error during registration." });
  }
});

module.exports = router;