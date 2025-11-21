const mongoose = require('mongoose');

const classSchema = new mongoose.Schema({
  subject: { type: String, required: true },
  teacher: { type: String },
  startTime: { type: Date, required: true },
  endTime: { type: Date },
  classGroup: { type: String, required: true } // Link class to specific group
});

module.exports = mongoose.model('Class', classSchema);