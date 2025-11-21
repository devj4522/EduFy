const mongoose = require('mongoose');

const studentSchema = new mongoose.Schema({
  name: { type: String, required: true },
  email: { type: String, required: true, unique: true },
  password: { type: String, required: true },  // Added field
  classGroup: { type: String, required: true },
  subscription: { type: Object }
});

module.exports = mongoose.model('Student', studentSchema);