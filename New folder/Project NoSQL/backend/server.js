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
const { MongoClient, ObjectId } = require('mongodb');
const webPush = require('./webpush');
const http = require('http');
const { Server } = require('socket.io');
const path = require('path');

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
let studentsCollection, timetablesCollection;

async function connectDirectMongo() {
  try {
    await client.connect();
    console.log("✅ MongoClient: Connected to MongoDB Atlas!");
    const database = client.db('edufy');
    studentsCollection = database.collection('students');
    timetablesCollection = database.collection('timetables');
    console.log("✅ Collections Ready: students & timetables");
    await ensureAttendanceIndex(); // <-- attendance unique index
    scheduleAllNotifications();
  } catch (err) {
    console.error("❌ Direct MongoDB connection failed:", err);
    process.exit(1);
  }
}
connectDirectMongo();

// ======================================================
// Helpers (normalizers + utils)
// ======================================================
const dayMap = { sunday:0, monday:1, tuesday:2, wednesday:3, thursday:4, friday:5, saturday:6 };
function normStr(s){ return (s ?? '').toString().trim(); }
function normCG(s){ return normStr(s).toUpperCase(); }
function normTime(t){
  const s = normStr(t);
  if(!s) return '';
  const [hRaw,mRaw] = s.split(':');
  const h = String(parseInt(hRaw || '0',10)).padStart(2,'0');
  const m = String(parseInt(mRaw || '0',10)).padStart(2,'0');
  return `${h}:${m}`;
}
function todayDateKey(d=new Date()){
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
}

// ======================================================
// Attendance: unique index helper
// ======================================================
async function ensureAttendanceIndex() {
  const db = client.db('edufy');
  await db.collection('attendance').createIndex(
    { studentId: 1, classId: 1, dateKey: 1 },
    { unique: true }
  );
  console.log('✅ Attendance index ensured (studentId+classId+dateKey unique)');
}

// ======================================================
// Scheduler: Weekly notifications based on day + time
// ======================================================
async function scheduleAllNotifications() {
  try {
    const allClasses = await timetablesCollection.find().toArray();

    allClasses.forEach(cls => {
      const dayNum = dayMap[(cls.day || "").toLowerCase()];
      if (dayNum === undefined) return;

      const [hours, minutes] = (cls.startTime || "00:00").split(":").map(Number);
      const notifyDate = new Date(1970, 0, 1, hours, (minutes || 0) - 5);
      const notifyHour = notifyDate.getHours();
      const notifyMinute = notifyDate.getMinutes();

      const rule = { dayOfWeek: dayNum, hour: notifyHour, minute: notifyMinute };

      schedule.scheduleJob(rule, async () => {
        const msg = `${cls.subject} class starts at ${cls.startTime}`;
        await sendClassNotification(cls.classGroup, "⏰ Class Reminder", msg);

        // 🔔 Rich payload for attendance prompt (roomno included)
        io.emit("classReminder", {
          title: "⏰ Class Reminder",
          message: msg,
          classId: cls._id?.toString?.() || null,
          subject: cls.subject,
          classGroup: cls.classGroup,
          day: cls.day,
          startTime: cls.startTime,
          endTime: cls.endTime,
          teacher: cls.teacher || null,
          roomno: cls.roomno || null
        });

        const students = await studentsCollection.find({ classGroup: cls.classGroup }).toArray();
        for (const s of students) {
          await saveStudentNotification(s._id, "⏰ Class Reminder", msg);
        }
        console.log(`📅 Weekly reminder sent for ${cls.subject} (${cls.day} ${cls.startTime})`);
      });

      console.log(`✅ Scheduled weekly reminder for ${cls.subject} every ${cls.day} at ${String(notifyHour).padStart(2, "0")}:${String(notifyMinute).padStart(2, "0")}`);
    });
  } catch (err) {
    console.error("❌ scheduleAllNotifications error:", err);
  }
}

// ======================================================
// Push Notification Function
// ======================================================
async function sendClassNotification(classGroup, title, message) {
  try {
    const students = await Student.find({ classGroup });
    for (const student of students) {
      if (student.subscription) {
        try {
          await webPush.sendNotification(student.subscription, JSON.stringify({ title, message }));
          await saveStudentNotification(student._id, title, message);
          console.log(`📢 Notification sent & stored for ${student.name} (${classGroup})`);
        } catch (err) {
          console.error(`❌ Push Error for ${student.name}:`, err.message);
        }
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
app.get('/api/ping', (req, res) => res.json({ok:true,time:new Date().toISOString()}));
app.get('/api/get-public-key', (req, res) => res.json({ publicKey: process.env.PUBLIC_VAPID_KEY }));

// ✅ STUDENT LIST (for View Students page)
app.get('/api/students', async (req, res) => {
  try {
    const raw = await studentsCollection.find(
      {},
      { projection: { _id: 1, fullName: 1, name: 1, email: 1, section: 1 } }
    ).toArray();

    const students = raw.map(s => ({
      _id: s._id.toString(),                 // ✅ send id as string
      fullName: s.fullName ?? s.name ?? 'N/A',
      email: s.email ?? '-',
      section: (s.section || '-').toString()
    }));

    res.set('Cache-Control', 'no-store');    // ✅ avoid old cached response
    res.json(students);
  } catch (err) {
    console.error('GET /api/students error:', err);
    res.status(500).json({ message: 'Failed to fetch students' });
  }
});

// Subscription Saving
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
    res.status(500).json({ message: "Internal server error" });
  }
});

// Student login
app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  try {
    const student = await studentsCollection.findOne({ email });
    if (student && student.password === password)
      res.status(200).json({ message: "Login successful", studentId: student._id });
    else res.status(401).json({ message: "Invalid credentials" });
  } catch (err) {
    res.status(500).json({ message: "Server error" });
  }
});

// Student profile
app.get("/students/:id", async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await studentsCollection.findOne({ _id: studentId });
    if (!student) return res.status(404).json({ message: "Student not found" });
    res.json(student);
  } catch {
    res.status(500).json({ message: "Failed to fetch student profile" });
  }
});

// Timetable for a student
app.get("/students/:id/timetable", async (req, res) => {
  try {
    const studentId = new ObjectId(req.params.id);
    const student = await studentsCollection.findOne({ _id: studentId });
    if (!student) return res.status(404).json({ message: "Student not found" });
    const section = student.section ? student.section.trim() : null;
    if (!section) return res.status(400).json({ message: "No section assigned" });
    const timetable = await timetablesCollection.find({ classGroup: section }).sort({ day: 1, startTime: 1 }).toArray();
    res.json(timetable);
  } catch {
    res.status(500).json({ message: "Failed to fetch timetable" });
  }
});

// Add new timetable entry
app.post('/api/timetable', async (req, res) => {
  try {
    const { day, startTime, endTime, subject, teacher, classGroup, roomno } = req.body;

    // ✅ DEBUG: dekh le backend ko kya mila
    console.log('➕ Timetable insert payload:', { day, startTime, endTime, subject, teacher, classGroup, roomno });

    const result = await timetablesCollection.insertOne({
      day,
      startTime,
      endTime,
      subject,
      teacher,
      classGroup,
      roomno: (roomno ?? '').toString().trim()   // 🧼 normalize
    });

    const dayNum = dayMap[(day || "").toLowerCase()];
    if (dayNum !== undefined) {
      const [h, m] = (startTime || "00:00").split(":").map(Number);
      const d = new Date(1970,0,1,h,(m || 0) - 5);
      const rule = { dayOfWeek: dayNum, hour: d.getHours(), minute: d.getMinutes() };

      schedule.scheduleJob(rule, async () => {
        const msg = `${subject} class starts at ${startTime}`;
        await sendClassNotification(classGroup, "⏰ Class Reminder", msg);

        io.emit("classReminder", {
          title: "⏰ Class Reminder",
          message: msg,
          classId: result.insertedId?.toString?.() || null,
          subject, classGroup, day, startTime, endTime, teacher,
          roomno: (roomno ?? '').toString().trim()       // ✅ include in emit
        });
      });

      console.log(`✅ New weekly class notification scheduled for ${subject} on ${day} at ${startTime}`);
    }

    res.status(201).json({ message: "Class added successfully", class: result });
  } catch (err) {
    console.error("❌ Timetable insert error:", err);
    res.status(500).json({ message: err.message });
  }
});

// Timetable list & delete
app.get('/api/timetable', async (req, res) => {
  const classes = await timetablesCollection.find().sort({ day: 1, startTime: 1 }).toArray();
  res.json(classes);
});
app.delete('/api/timetable/:id', async (req, res) => {
  await timetablesCollection.deleteOne({ _id: new ObjectId(req.params.id) });
  res.json({ message: "Class deleted successfully" });
});

// ======================================================
// Teacher Dashboard Routes
// ======================================================
app.post('/api/teacher/register', async (req, res) => {
  const { name, email, password } = req.body;
  const db = client.db('edufy');
  if (await db.collection('teachers').findOne({ email }))
    return res.status(400).json({ message: "Teacher already exists" });
  const result = await db.collection('teachers').insertOne({ name, email, password, createdAt: new Date() });
  res.status(201).json({ message: "Registered", teacherId: result.insertedId });
});

app.post('/api/teacher/login', async (req, res) => {
  const { email, password } = req.body;
  const db = client.db('edufy');
  const teacher = await db.collection('teachers').findOne({ email });
  if (!teacher || teacher.password !== password)
    return res.status(401).json({ message: "Invalid credentials" });
  res.json({ message: "Login successful", teacherId: teacher._id, teacherName: teacher.name });
});

app.get("/api/teacher/:id/timetable", async (req, res) => {
  const db = client.db('edufy');
  const teacher = await db.collection('teachers').findOne({ _id: new ObjectId(req.params.id) });
  if (!teacher) return res.json([]);

  // try by teacherId first (agar future mein store karoge), warna name regex (case-insensitive)
  const q = {
    $or: [
      { teacherId: teacher._id },  // only works if you start saving teacherId in timetable
      { teacher: { $regex: new RegExp(`^${teacher.name}$`, 'i') } },
      // fallback: first-name partial (jaise "Diptanshu")
      { teacher: { $regex: new RegExp(`^${teacher.name.split(' ')[0]}`, 'i') } }
    ]
  };

  const timetable = await db.collection('timetables')
    .find(q)
    .sort({ day: 1, startTime: 1 })
    .toArray();

  res.json(timetable);
});

// ======================================================
// 📢 Announcements
// ======================================================
app.post('/api/announcements', async (req, res) => {
  const { teacherName, message } = req.body;
  const db = client.db('edufy');
  const ann = { teacherName, message, createdAt: new Date(), expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000) };
  await db.collection('announcements').insertOne(ann);
  io.emit("new-announcement", { teacherName, message });
  res.status(201).json({ message: "Announcement created" });
});

// Modified: support ?all=1 to include expired / past announcements.
// Default: only active (expiresAt > now)
app.get('/api/announcements', async (req, res) => {
  try {
    const db = client.db('edufy');
    const includeAll = req.query.all === '1' || req.query.all === 'true';
    if (includeAll) {
      const anns = await db.collection('announcements').find().sort({ createdAt: -1 }).toArray();
      return res.json(anns);
    } else {
      const anns = await db.collection('announcements').find({ expiresAt: { $gt: new Date() } }).sort({ createdAt: -1 }).toArray();
      return res.json(anns);
    }
  } catch (e) {
    console.error('GET /api/announcements error:', e);
    res.status(500).json({ message: 'Failed to fetch announcements' });
  }
});

// ======================================================
// 🛎️ Student Notifications
// ======================================================
async function saveStudentNotification(studentId, title, message) {
  try {
    const db = client.db('edufy');
    const notifications = db.collection('notifications');
    await notifications.insertOne({
      studentId,
      title,
      message,
      timestamp: new Date(),
      expiresAt: new Date(Date.now() + 12 * 60 * 60 * 1000)
    });
  } catch (err) {
    console.error("❌ Error saving notification:", err);
  }
}

app.get("/api/student/:id/notifications", async (req, res) => {
  const db = client.db('edufy');
  const notifications = db.collection('notifications');
  const studentId = new ObjectId(req.params.id);
  const now = new Date();
  const data = await notifications.find({ studentId, expiresAt: { $gt: now } }).sort({ timestamp: -1 }).toArray();
  res.json(data);
});

schedule.scheduleJob("0 * * * *", async () => {
  const db = client.db("edufy");
  const notifications = db.collection("notifications");
  const result = await notifications.deleteMany({ expiresAt: { $lt: new Date() } });
  if (result.deletedCount > 0)
    console.log(`🧹 Cleaned ${result.deletedCount} expired notifications`);
});

// ======================================================
// ✅ ATTENDANCE APIs
// ======================================================
const ATTENDANCE_WINDOW_MIN = 20; // class start se ±20 min

// ===========================
// ✅ FIXED ATTENDANCE MARK API
// ===========================

app.post("/api/attendance/mark", async (req, res) => {
  try {
    // accept both studentEmail and email keys from clients
    let { studentId, studentEmail, email, status, classId, subject, startTime, classGroup } = req.body;
    studentEmail = studentEmail || email || null;

    if (!status || !classId || !subject || !startTime || !classGroup || (!studentId && !studentEmail)) {
      return res.status(400).json({ message: "Missing fields" });
    }

    // Resolve studentId if not a valid ObjectId
    if (!studentId || !ObjectId.isValid(studentId)) {
      if (!studentEmail) {
        return res.status(400).json({ message: "Invalid studentId and no fallback email supplied" });
      }
      const sDoc = await studentsCollection.findOne({ email: studentEmail });
      if (!sDoc) return res.status(404).json({ message: "Student not found by email" });
      studentId = sDoc._id.toString();
    }

    if (!ObjectId.isValid(classId)) {
      return res.status(400).json({ message: "Invalid classId" });
    }

    const doc = {
      studentId: new ObjectId(studentId),
      classId: new ObjectId(classId),
      subject,
      classGroup,
      startTime,
      status,
      markedAt: new Date()
    };

    const db = client.db("edufy");

    await db.collection("attendance")
      .updateOne(
        { studentId: doc.studentId, classId: doc.classId, startTime, subject, classGroup },
        { $set: doc },
        { upsert: true }
      );

    // emit realtime event so students can update UI
    try {
      const cls = await db.collection('timetables').findOne({ _id: doc.classId });
      io.emit('attendance-updated', {
        studentId: doc.studentId.toString(),
        classId: doc.classId.toString(),
        subject: doc.subject,
        status: doc.status,
        markedAt: doc.markedAt,
        classGroup: doc.classGroup,
        startTime: doc.startTime,
        teacher: cls?.teacher || null
      });
    } catch (e) {
      console.warn('emit attendance-updated warning:', e.message || e);
    }

    res.json({ success: true, ok: true });
  } catch (err) {
    console.error("❌ Attendance mark error:", err);
    res.status(500).json({ message: "Internal server error" });
  }
});

// GET /api/attendance/recent/:studentId
app.get('/api/attendance/recent/:studentId', async (req, res) => {
  try {
    const db = client.db('edufy');
    const studentId = new ObjectId(req.params.studentId);
    const rows = await db.collection('attendance')
      .find({ studentId })
      .sort({ markedAt: -1 })
      .limit(10)
      .toArray();
    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to load recent attendance' });
  }
});

// --- Add to server.js (near other attendance routes) ---
app.post('/api/attendance/bulk', async (req, res) => {
  try {
    const { items = [], classId, subject, startTime, classGroup } = req.body;
    const db = client.db('edufy');

    // resolve class once
    let cls = null;
    if (classId) {
      try { cls = await db.collection('timetables').findOne({ _id: new ObjectId(classId) }); } catch {}
    }
    if (!cls && subject && startTime && classGroup) {
      cls = await db.collection('timetables').findOne({
        subject: { $regex: new RegExp(`^${subject}$`, 'i') },
        startTime,
        classGroup: { $regex: new RegExp(`^${classGroup}$`, 'i') },
      });
    }
    if (!cls) return res.status(404).json({ message: 'Class not found' });

    const dateKey = new Date().toISOString().slice(0,10);
    const results = [];

    for (const it of items) {
      try {
        let sid = it.studentId;
        if (!sid && it.email) {
          const s = await db.collection('students').findOne({ email: it.email });
          if (s) sid = s._id;
        }
        if (!sid) { results.push({ ok:false, email: it.email, reason:'student not found' }); continue; }

        await db.collection('attendance').updateOne(
          { studentId: new ObjectId(sid), classId: cls._id, dateKey },
          { $set: {
              studentId: new ObjectId(sid),
              classId: cls._id,
              subject: cls.subject,
              classGroup: cls.classGroup,
              startTime: cls.startTime,
              status: it.status,
              markedAt: new Date(),
              dateKey
          }},
          { upsert: true }
        );

        // emit realtime event per student (teacher-marked)
        try {
          io.emit('attendance-updated', {
            studentId: String(sid),
            classId: String(cls._id),
            subject: cls.subject,
            status: it.status,
            markedAt: new Date(),
            classGroup: cls.classGroup,
            startTime: cls.startTime,
            teacher: cls.teacher || null
          });
        } catch (e) {
          console.warn('emit bulk attendance-updated warning:', e.message || e);
        }

        results.push({ ok:true, studentId: String(sid), status: it.status });
      } catch (e) {
        results.push({ ok:false, email: it.email, reason: e.message });
      }
    }

    const failed = results.filter(r => !r.ok).length;
    res.json({ ok:true, failed, results });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Bulk attendance failed' });
  }
});

// Subject-wise percentage
// GET /api/attendance/subject-percent?studentId=..&subject=..&classGroup=A&from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/attendance/subject-percent', async (req, res) => {
  try {
    let { studentId, subject, classGroup, from, to } = req.query;
    if (!studentId || !subject) return res.status(400).json({ message: 'studentId & subject required' });

    subject = normStr(subject);
    classGroup = classGroup ? normCG(classGroup) : undefined;

    const db = client.db('edufy');
    const match = {
      studentId: new ObjectId(studentId),
      subject: { $regex: new RegExp(`^${subject}$`, 'i') }
    };
    if (classGroup) match.classGroup = { $regex: new RegExp(`^${classGroup}$`, 'i') };
    if (from || to) {
      const r = {};
      if (from) r.$gte = from;
      if (to)   r.$lte = to;
      match.dateKey = r;
    }

    const agg = await db.collection('attendance').aggregate([
      { $match: match },
      { $group: {
          _id: null,
          total: { $sum: 1 },
          presents: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absents: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } },
        }},
      { $project: {
          _id: 0, total: 1, presents: 1, absents: 1,
          percent: { $cond: [{ $eq: ['$total', 0] }, 0,
                     { $round: [{ $multiply: [{ $divide: ['$presents', '$total'] }, 100] }, 2] }] }
        }}
    ]).toArray();

    res.json(agg[0] || { total: 0, presents: 0, absents: 0, percent: 0 });
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to compute percentage' });
  }
});

// All-subject summary for a student (optional)
// GET /api/attendance/summary?studentId=..&from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/attendance/summary', async (req, res) => {
  try {
    const { studentId, from, to } = req.query;
    if (!studentId) return res.status(400).json({ message: 'studentId required' });

    const db = client.db('edufy');
    const match = { studentId: new ObjectId(studentId) };
    if (from || to) {
      const r = {};
      if (from) r.$gte = from;
      if (to)   r.$lte = to;
      match.dateKey = r;
    }

    const rows = await db.collection('attendance').aggregate([
      { $match: match },
      { $group: {
          _id: { subject: '$subject', classGroup: '$classGroup' },
          total: { $sum: 1 },
          presents: { $sum: { $cond: [{ $eq: ['$status', 'present'] }, 1, 0] } },
          absents: { $sum: { $cond: [{ $eq: ['$status', 'absent'] }, 1, 0] } }
        }},
      { $project: {
          _id: 0,
          subject: '$_id.subject',
          classGroup: '$_id.classGroup',
          total: 1, presents: 1, absents: 1,
          percent: { $cond: [{ $eq: ['$total', 0] }, 0,
                     { $round: [{ $multiply: [{ $divide: ['$presents', '$total'] }, 100] }, 2] }] }
        }},
      { $sort: { subject: 1 } }
    ]).toArray();

    res.json(rows);
  } catch (e) {
    console.error(e);
    res.status(500).json({ message: 'Failed to load summary' });
  }
});

// GET /api/attendance/student?studentId=...&limit=12&skip=0&subject=&status=&from=YYYY-MM-DD&to=YYYY-MM-DD
app.get('/api/attendance/student', async (req, res) => {
  try {
    const db = client.db('edufy');
    const {
      studentId, limit = 12, skip = 0, subject, status, from, to
    } = req.query;

    if (!studentId) return res.status(400).json({ message: 'studentId required' });

    const match = { studentId: new ObjectId(studentId) };

    if (subject) match.subject = { $regex: new RegExp(`^${subject}$`, 'i') };
    if (status) match.status = status;

    // date filtering using markedAt (if from/to provided)
    if (from || to) {
      match.markedAt = {};
      if (from) {
        // from 00:00:00
        match.markedAt.$gte = new Date(`${from}T00:00:00.000Z`);
      }
      if (to) {
        // to 23:59:59
        match.markedAt.$lte = new Date(`${to}T23:59:59.999Z`);
      }
    }

    const lim = Math.min(200, parseInt(limit, 10) || 12);
    const sk  = Math.max(0, parseInt(skip, 10) || 0);

    const col = db.collection('attendance');

    // total count
    const total = await col.countDocuments(match);

    // fetch rows - newest first
    const rows = await col.find(match)
      .sort({ markedAt: -1 })
      .skip(sk)
      .limit(lim)
      .toArray();

    // best-effort: attach teacher name from timetables if missing
    const timetables = db.collection('timetables');
    for (let r of rows) {
      if (!r.teacher && r.classId) {
        try {
          const cls = await timetables.findOne({ _id: (typeof r.classId === 'string' ? new ObjectId(r.classId) : r.classId) });
          if (cls && cls.teacher) r.teacher = cls.teacher;
        } catch (e) { /* ignore lookup errors */ }
      }
      // convert ObjectIds and dates to serializable forms
      r.studentId = String(r.studentId);
      r.classId   = r.classId ? String(r.classId) : null;
    }

    res.json({ rows, total });
  } catch (err) {
    console.error('GET /api/attendance/student error:', err);
    res.status(500).json({ message: 'Failed to fetch attendance' });
  }
});

// ======================================================
// NEW: Test push endpoint — send a test push to a student (or all students if studentId omitted).
// POST /api/notifications/test
// body: { studentId?: "<id>", title: "...", message: "..." }
app.post('/api/notifications/test', async (req, res) => {
  try {
    const { studentId, title = 'Test', message = 'This is a test notification' } = req.body;
    const db = client.db('edufy');

    let targets = [];
    if (studentId) {
      const s = await db.collection('students').findOne({ _id: new ObjectId(studentId) });
      if (!s) return res.status(404).json({ message: 'Student not found' });
      if (s.subscription) targets.push({ id: String(s._id), subscription: s.subscription });
    } else {
      const all = await db.collection('students').find({ subscription: { $exists: true, $ne: null } }).toArray();
      targets = all.map(a => ({ id: String(a._id), subscription: a.subscription })).filter(t => t.subscription);
    }

    let sent = 0, failed = 0;
    for (const t of targets) {
      try {
        await webPush.sendNotification(t.subscription, JSON.stringify({ title, message }));
        await saveStudentNotification(t.id, title, message);
        sent++;
      } catch (e) {
        console.error('push test send error for', t.id, e.message || e);
        failed++;
      }
    }

    res.json({ ok:true, sent, failed, targets: targets.length });
  } catch (e) {
    console.error('POST /api/notifications/test error:', e);
    res.status(500).json({ message: 'Failed to send test push' });
  }
});

// ======================================================
// Serve frontend + sound
// ======================================================
app.use(express.static(path.join(__dirname, '../frontend')));
app.get('/notification.mp3', (req, res) => {
  res.sendFile(path.join(__dirname, '../frontend', 'notification.mp3'));
});

// ======================================================
// 9. Start Server
// ======================================================
server.listen(PORT, () => console.log(`🚀 Server running on port ${PORT}`));
