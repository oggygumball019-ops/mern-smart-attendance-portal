const mongoose = require('mongoose');

const attendanceSchema = new mongoose.Schema({
  studentId: { 
    type: mongoose.Schema.Types.ObjectId, 
    ref: 'Student', 
    required: true 
  },
  rollNo: { type: String },
  name: { type: String },
  status: { type: String, default: 'Present' },
  confidence: { type: String, default: 'N/A' },
  timestamp: { type: Date, default: Date.now },
  date: { type: Date, default: Date.now }
}, { timestamps: true });

module.exports = mongoose.model('Attendance', attendanceSchema);