const express = require('express');
const router = express.Router();
const Student = require('../models/Student'); // Adjust path if your model is elsewhere

// POST /api/students/register
router.post('/register', async (req, res) => {
  try {
    const { name, rollNo, faceEmbedding } = req.body;

    const student = new Student({
      name,
      rollNo,
      faceEmbedding
    });

    await student.save();
    res.status(201).json({ message: 'Student registered successfully!' });
  } catch (error) {
    res.status(400).json({ message: error.message || 'Error registering student.' });
  }
});

module.exports = router;