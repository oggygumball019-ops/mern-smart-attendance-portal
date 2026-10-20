const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: String,
  rollNo: String,
  role: String,
  faceDescriptor: [Number],
  createdAt: { type: Date, default: Date.now }
});

const Student = mongoose.model('Student', studentSchema);

async function seedDB() {
  await mongoose.connect('mongodb://127.0.0.1:27017/face_attendance');
  
  // Dummy 128-d descriptor array
  const dummyVector = Array(128).fill(0.1);

  await Student.deleteMany({}); // reset
  await Student.insertMany([
    { name: "G Bhuvaneshwari", rollNo: "310624148013", role: "student", faceDescriptor: dummyVector },
    { name: "Cornelia hale", rollNo: "310624148014", role: "student", faceDescriptor: dummyVector },
    { name: "Hannie alisha", rollNo: "310624148015", role: "student", faceDescriptor: dummyVector }
  ]);

  console.log("Database seeded successfully! Refresh MongoDB Compass now.");
  process.exit(0);
}

seedDB();