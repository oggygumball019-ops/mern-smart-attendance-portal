const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  rollNo: { type: String, required: true, unique: true, trim: true },
  className: { type: String, trim: true },
  faceEmbedding: { type: [Number], required: true }
}, { timestamps: true });

module.exports =
  mongoose.models.Student ||
  mongoose.model('Student', studentSchema);
