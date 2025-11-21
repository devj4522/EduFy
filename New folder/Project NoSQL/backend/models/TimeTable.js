const mongoose = require('mongoose');

const timeTableSchema = new mongoose.Schema({
  day: { type: String, required: true },        // Example: Monday
  startTime: { type: String, required: true },  // Example: "11:10 AM"
  endTime: { type: String, required: true },    // Example: "12:00 PM"
  subject: { type: String, required: true },    // Example: "CN"
  teacher: { type: String, required: true },    // Example: "RAS"
  classGroup: { type: String, required: true }  // Example: "F"
});

module.exports = mongoose.model('TimeTable', timeTableSchema);