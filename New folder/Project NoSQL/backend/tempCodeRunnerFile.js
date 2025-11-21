// ======================================================
// 1. Load Environment Variables
// ======================================================
require('dotenv').config();

// ======================================================
// 2. Import Dependencies
// ======================================================
const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const schedule = require('node-schedule');
const { MongoClient, ObjectId } = require('mongodb'); // Direct MongoDB
const webPush = require('./webpush'); // Push notifications

// ✅ Added for real-time alerts
const http = require('http');
const { Server } = require('socket.io');
const path = require('path'); // ✅ Added for serving static files

// ======================================================
// 3. Models (Mongoose) - Optional
// ======================================================
const Student = require('./models/Student');
const Class = require('./models/Class');
const TimeTable = require('./models/TimeTable');

// ======================================================
// 4. Initialize App
// ======================================================
const app = express();
const PORT = process.env.PORT || 5000;

// ✅ Create HTTP + Socket.io server
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: "*" } });

// ======================================================
// 5. Middleware
// ======================================================
app.use(cors());
app.use(express.json());

// ======================================================
// 🔔 Socket.io Connections
// ======================================================
io.on("connection", (socket) => {
  console.log("🟢 New client connected:", socket.id);
  socket.on("disconnect", () => {
    console.log("🔴 Client disconnected:", socket.id);
  });
});

// ======================================================
// 6. Mongoose Connection (Optional)
// ======================================================
mongoose.connect(process.env.MONGO_URI)
  .then(() => console.log("✅ Mongoose: Connected"))
  .catch(err => console.error("❌ Mongoose failed:", err));

// ======================================================
// 7. Direct MongoDB Connection
// ======================================================
const uri = process.env.MONGO_URI;
const client = new MongoClient(uri);

let studentsCollection;
let timetablesCollection;

async function connectDirectMongo() {
  try {
    await client.connect();
    console.log("✅ MongoClient: Connected to MongoDB Atlas!");

    const database = client.db('edufy');
    studentsCollection = database.collection('students');
    timetablesCollection = database.collection('timetables');

    console.log("✅ Collections Ready: students & timetables");

    scheduleAllNotifications();
  } catch (err) {
    console.error("❌ Direct MongoDB connection failed:", err);
    process.exit(1);
  }
}
connectDirectMongo();

// ======================================================
// Scheduler: All upcoming notifications
// ======================================================
async function scheduleAllNotifications() {
  const allClasses = await timetablesCollection.find().toArray();

  allClasses.forEach(cls => {
    const [hours, minutes] = cls.startTime.split(":").map(Number);
    const now = new Date();
    const classTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    const notificationTime = new Date(classTime.getTime() - 5 * 60000); // 5 mins before

    if (notificationTime > new Date()) {
      schedule.scheduleJob(notificationTime, async () => {
        await sendClassNotification(
          cls.classGroup,
          'Class Reminder',
          `${cls.subject} class starts at ${cls.startTime}`
        );

        // ✅ Emit real-time class reminder
        io.emit("classReminder", {
          title: "Class Reminder",
          message: `${cls.subject} class starts at ${cls.startTime}`,
          classGroup: cls.classGroup
        });
      });
      console.log(`✅ Notification scheduled for ${cls.subject} at ${notificationTime}`);
    }
  });
}

// ======================================================
// Push Notification Function
// ======================================================
async function sendClassNotification(classGroup, title, message) {
  try {
    const students = await Student.find({ classGroup });
    if (!students.length) {
      console.log(`ℹ️ No students found in class group: ${classGroup}`);
      return;
    }

    for (const student of students) {
      if (student.subscription) {
        try {
          await webPush.sendNotification(
            student.subscription,
            JSON.stringify({ title, message })
          );
          console.log(`📢 Notification sent to ${student.name} (${classGroup})`);
        } catch (err) {
          console.error(`❌ Push Error for ${student.name}:`, err.message);
        }
      } else {
        console.log(`ℹ️ ${student.name} has no subscription`);
      }
    }
  } catch (error) {
    console.error("❌ Notification sending failed:", error);
  }
}

// ======================================================
// 8. Routes
// ======================================================
app.get('/', (req, res) => res.send('Server running & connected to MongoDB!'));

// --- Get Public VAPID Key
app.get('/api/get-public-key', (req, res) => {
  res.json({ publicKey: process.env.PUBLIC_VAPID_KEY });
});

// --- Save Subscription
app.post('/api/save-subscription', async (req, res) => {
  try {
    const { studentId, subscription } = req.body;
    if (!studentId || !subscription)
      return res.status(400).json({ message: "StudentId and subscription are required" });

    const updated = await studentsCollection.updateOne(
      { _id: new ObjectId(studentId) },
      { $set: { subscription } }
    );

    if (updated.modifiedCount === 1)
      res.status(200).json({ message: "Subscription saved successfully" });
    else res.status(404).json({ message: "Student not found" });
  } catch (err) {
    console.error("Error saving subscription:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// --- Student Login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const student = await studentsCollection.findOne({ email });
    if (student && student.password === password)
      res.status(200).json({ message: "Login successful", studentId: student._id });
    else res.status(401).json({ message: "Invalid email or password" });
  } catch (err) {
    console.error("Login error:", err);
    res.status(500).json({ message: "Server error" });
  }
});

// --- Student Profile
app.get("/students/:id", async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await studentsCollection.findOne({ _id: studentId });
    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json(student);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch student profile" });
  }
});

// --- Student Timetable
app.get("/students/:id/timetable", async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await studentsCollection.findOne({ _id: studentId });
    if (!student) return res.status(404).json({ message: "Student not found" });

    const section = student.section ? student.section.trim() : null;
    if (!section) return res.status(400).json({ message: "No section assigned" });

    const timetable = await timetablesCollection
      .find({ classGroup: section })
      .sort({ day: 1, startTime: 1 })
      .toArray();
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: "Failed to fetch timetable" });
  }
});

// --- Add timetable entry
app.post('/api/timetable', async (req, res) => {
  try {
    const { day, startTime, endTime, subject, teacher, classGroup } = req.body;
    const newClass = { day, startTime, endTime, subject, teacher, classGroup };
    const result = await timetablesCollection.insertOne(newClass);

    const [hours, minutes] = startTime.split(":").map(Number);
    const now = new Date();
    const classTime = new Date(now.getFullYear(), now.getMonth(), now.getDate(), hours, minutes);
    const notifyAt = new Date(classTime.getTime() - 5 * 60000);

    if (notifyAt > new Date()) {
      schedule.scheduleJob(notifyAt, async () => {
        await sendClassNotification(classGroup, "Class Reminder", `${subject} class starts at ${startTime}`);
        io.emit("classReminder", { title: "Class Reminder", message: `${subject} class starts at ${startTime}` });
      });
    }

    res.status(201).json({ message: "Class added successfully", class: result });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Get timetable
app.get('/api/timetable', async (req, res) => {
  try {
    const classes = await timetablesCollection.find().sort({ day: 1, startTime: 1 }).toArray();
    res.json(classes);
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// --- Delete timetable
app.delete('/api/timetable/:id', async (req, res) => {
  try {
    await timetablesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
    res.json({ message: "Class deleted successfully" });
  } catch (err) {
    res.status(500).json({ message: err.message });
  }
});

// ======================================================
// 👨‍🏫 Teacher Dashboard Routes
// ======================================================
app.post('/api/teacher/register', async (req, res) => {
  try {
    const { name, email, password } = req.body;
    if (!name || !email || !password)
      return res.status(400).json({ message: "All fields required" });

    const db = client.db('edufy');
    const teachers = db.collection('teachers');
    if (await teachers.findOne({ email }))
      return res.status(400).json({ message: "Teacher already exists" });

    const result = await teachers.insertOne({ name, email, password, createdAt: new Date() });
    res.status(201).json({ message: "Registered", teacherId: result.insertedId });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.post('/api/teacher/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    const db = client.db('edufy');
    const teacher = await db.collection('teachers').findOne({ email });
    if (!teacher || teacher.password !== password)
      return res.status(401).json({ message: "Invalid credentials" });
    res.json({ message: "Login successful", teacherId: teacher._id, teacherName: teacher.name });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/teacher/:id", async (req, res) => {
  try {
    const db = client.db('edufy');
    const teacher = await db.collection('teachers').findOne({ _id: new ObjectId(req.params.id) });
    if (!teacher) return res.status(404).json({ message: "Teacher not found" });
    res.json(teacher);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get("/api/teacher/:id/timetable", async (req, res) => {
  try {
    const db = client.db('edufy');
    const teacher = await db.collection('teachers').findOne({ _id: new ObjectId(req.params.id) });
    const timetable = await db.collection('timetables').find({ teacher: teacher.name }).sort({ day: 1 }).toArray();
    res.json(timetable);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ======================================================
// 📢 Announcements
// ======================================================
app.post('/api/announcements', async (req, res) => {
  try {
    const { teacherName, message } = req.body;
    if (!teacherName || !message)
      return res.status(400).json({ message: "Teacher name and message required" });

    const db = client.db('edufy');
    const ann = { teacherName, message, createdAt: new Date(), expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) };
    await db.collection('announcements').insertOne(ann);

    // ✅ Emit announcement in real-time (fixed event name)
    io.emit("new-announcement", { teacherName, message });

    res.status(201).json({ message: "Announcement created" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

app.get('/api/announcements', async (req, res) => {
  try {
    const db = client.db('edufy');
    const anns = await db.collection('announcements')
      .find({ expiresAt: { $gt: new Date() } })
      .sort({ createdAt: -1 })
      .toArray();
    res.json(anns);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ======================================================
// 👨‍🏫 Get All Students
// ======================================================
app.get('/api/students', async (req, res) => {
  try {
    const db = client.db('edufy');
    const students = await db.collection('students')
      .find({}, { projection: { fullName: 1, email: 1, section: 1 } })
      .sort({ section: 1 })
      .toArray();
    res.json(students);
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// ======================================================
// 🔔 Serve Notification Sound
// ======================================================
// 🔔 Serve Notification Sound (MP3 version)
app.use(express.static(path.join(__dirname, 'frontend')));
app.get('/notification.mp3', (req, res) => {
  res.sendFile(path.join(__dirname, 'frontend', 'notification.mp3'));
});

// ======================================================
// 9. Start Server
// ======================================================
server.listen(PORT, () => console.log(`🚀 Server with Socket.io running on port ${PORT}`));
