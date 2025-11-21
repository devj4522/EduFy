// ============================
// student_dashboard.js (UPDATED with ROOM NO. + Recent Attendance + Realtime)
// ============================

const PUBLIC_VAPID_KEY = "BDKgOIWjIj8t0GWfp-0aai7WDgNV8MtRNAiTdM_7D-aXATZai_5WXRbskRaG6YOAsVmqkqwCHrJhw2aS_YcBGb4";

function urlBase64ToUint8Array(base64String) {
  const padding = "=".repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/-/g, "+").replace(/_/g, "/");
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map((char) => char.charCodeAt(0)));
}

const API = "http://localhost:5000/api";

// Small helper
function formatDT(t) {
  try { return new Date(t).toLocaleString(); }
  catch { return ""; }
}

window.addEventListener("DOMContentLoaded", async () => {
  const studentId = localStorage.getItem("studentId");
  if (!studentId) {
    console.error("You are not logged in. Redirecting...");
    window.location.href = "login.html";
    return;
  }

  const isDashboard = window.location.pathname.includes("student_dashboard");
  const isTimetablePage = window.location.pathname.includes("timetables");

  try {
    const student = await fetchStudentInfo(studentId);

    // Timetable only where needed
    if (isDashboard || isTimetablePage) {
      await fetchTimetable(studentId);
    }

    if (isDashboard) {
      await subscribeUser(student);
      await fetchAnnouncements();
      await fetchStoredNotifications(studentId);
      await loadSubjects(studentId);        // fill subject dropdown
      await refreshSubjectPercent();        // initial percent
      await loadRecentAttendance(studentId); // ✅ load last 10 attendance

      setInterval(() => {
        fetchAnnouncements();
        fetchStoredNotifications(studentId);
      }, 2 * 60 * 1000);

      initSocketListeners(student.section);
      initServiceWorkerMessages();
    }

    // Subject percent controls
    const btnLoad = document.getElementById("btnLoad");
    if (btnLoad) {
      btnLoad.addEventListener("click", refreshSubjectPercent);
    }

  } catch (err) {
    console.error("Dashboard init error:", err);
  }
});

// ---------------------------
// Fetch student info
// ---------------------------
async function fetchStudentInfo(studentId) {
  const profileDiv = document.getElementById("student-info");
  const welcome = document.getElementById("welcome");

  try {
    const res = await fetch(`http://localhost:5000/students/${studentId}`);
    if (!res.ok) throw new Error("Failed to load student profile.");
    const student = await res.json();

    localStorage.setItem("student", JSON.stringify(student));

    if (welcome) welcome.textContent = `Welcome, ${student.fullName} 👩‍🎓`;

    if (profileDiv) {
      profileDiv.innerHTML = `
        <h3>👤 My Profile</h3>
        <p><strong>Name:</strong> ${student.fullName}</p>
        <p><strong>Email:</strong> ${student.email}</p>
        <p><strong>Section:</strong> ${student.section}</p>
      `;
    }
    return student;
  } catch (err) {
    if (profileDiv) {
      profileDiv.innerHTML = `<p style="color:red;">${err.message}</p>`;
    }
    throw err;
  }
}

// ---------------------------
// Fetch timetable (with ROOM NO.)
// ---------------------------
async function fetchTimetable(studentId) {
  const tableBody = document.querySelector("#timetable-table tbody");
  if (!tableBody) return;

  try {
    const res = await fetch(`http://localhost:5000/students/${studentId}/timetable`);
    if (!res.ok) throw new Error("Failed to load timetable.");
    const classes = await res.json();

    tableBody.innerHTML = "";
    if (!classes.length) {
      tableBody.innerHTML = "<tr><td colspan='8'>No classes scheduled</td></tr>";
      return;
    }

    const daysOrder = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
    const timeSlots = [...new Set(classes.map(cls => `${cls.startTime} - ${cls.endTime}`))].sort((a, b) => a.localeCompare(b));
    const timetableGrid = {};

    classes.forEach(cls => {
      const slot = `${cls.startTime} - ${cls.endTime}`;
      if (!timetableGrid[slot]) timetableGrid[slot] = {};
      timetableGrid[slot][cls.day] = cls;
    });

    timeSlots.forEach(slot => {
      const row = document.createElement("tr");
      const timeCell = document.createElement("td");
      timeCell.style.fontWeight = "bold";
      timeCell.textContent = slot;
      row.appendChild(timeCell);

      daysOrder.forEach(day => {
        const classCell = document.createElement("td");
        const cls = timetableGrid[slot] ? timetableGrid[slot][day] : null;

        // ✅ ROOM NO. visible with subject
        classCell.innerHTML = cls
          ? `<div>${cls.subject}${cls.roomno ? ` <small style="opacity:.75"> (Room ${cls.roomno})</small>` : ""}</div>
             <span>${cls.teacher || ""}</span>`
          : "";
        row.appendChild(classCell);
      });

      tableBody.appendChild(row);
    });
  } catch (err) {
    tableBody.innerHTML = `<tr><td colspan="8" style="color:red;text-align:center;">${err.message}</td></tr>`;
  }
}

// ---------------------------
// Push Notification Subscription
// ---------------------------
async function subscribeUser(student) {
  if ("serviceWorker" in navigator && "PushManager" in window) {
    try {
      const registration = await navigator.serviceWorker.register("sw.js");
      await navigator.serviceWorker.ready;

      const vapidRes = await fetch(`${API}/get-public-key`);
      const vapidData = await vapidRes.json();

      const subscription = await registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToUint8Array(vapidData.publicKey),
      });

      await fetch(`${API}/save-subscription`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          studentId: student._id,
          subscription,
        }),
      });

      console.log("✅ User subscribed for push notifications!");
    } catch (err) {
      console.error("❌ Push subscription failed:", err);
    }
  } else {
    console.warn("❌ Service Worker or PushManager not supported.");
  }
}

// ---------------------------
// Fetch announcements
// ---------------------------
let lastAnnouncementCount = 0;

async function fetchAnnouncements() {
  const list = document.getElementById("announcement-list");
  if (!list) return;

  try {
    const res = await fetch(`${API}/announcements`);
    const announcements = await res.json();

    list.innerHTML = "";
    if (!announcements.length) {
      list.innerHTML = "<li>No announcements right now.</li>";
      lastAnnouncementCount = 0;
      return;
    }

    announcements.forEach((a) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${a.teacherName}:</strong> ${a.message}<br><small>Posted ${new Date(a.createdAt).toLocaleString()}</small>`;
      list.appendChild(li);
    });

    if (announcements.length > lastAnnouncementCount) {
      playNotificationSound();
      const latest = announcements[0];
      showToast(`📢 ${latest.teacherName}: ${latest.message}`);
    }

    lastAnnouncementCount = announcements.length;
  } catch (err) {
    list.innerHTML = '<li style="color:red;">Error loading announcements</li>';
  }
}

// ---------------------------
// Fetch stored notifications (bell dropdown)
// ---------------------------
let lastNotificationCount = 0;

async function fetchStoredNotifications(studentId) {
  const bellList = document.getElementById("bell-dropdown");
  const badge = document.getElementById("bell-badge");
  if (!bellList || !badge) return;

  try {
    const res = await fetch(`${API}/student/${studentId}/notifications`);
    if (!res.ok) throw new Error("Failed to fetch notifications");

    const notifications = await res.json();
    bellList.innerHTML = "";

    if (!notifications.length) {
      bellList.innerHTML = "<li>No new notifications</li>";
      badge.style.display = "none";
      lastNotificationCount = 0;
      return;
    }

    notifications.forEach((n) => {
      const li = document.createElement("li");
      li.innerHTML = `<strong>${n.title}</strong><br>${n.message}<br><small>${new Date(n.timestamp).toLocaleString()}</small>`;
      bellList.appendChild(li);
    });

    badge.textContent = notifications.length;
    badge.style.display = "inline-block";

    if (notifications.length > lastNotificationCount) {
      playNotificationSound();
      const latest = notifications[0];
      showToast(`🔔 ${latest.title}: ${latest.message}`);
    }

    lastNotificationCount = notifications.length;
  } catch (err) {
    console.error("❌ Notification fetch error:", err);
  }
}

// ---------------------------
// Bell dropdown toggle
// ---------------------------
function toggleBell() {
  const drop = document.getElementById("bell-dropdown");
  drop.style.display = drop.style.display === "block" ? "none" : "block";
}

// ---------------------------
// Sound + SW messages
// ---------------------------
function playNotificationSound() {
  const audio = new Audio("notification.mp3");
  audio.play().catch(() => {});
}
function initServiceWorkerMessages() {
  if ("serviceWorker" in navigator) {
    navigator.serviceWorker.addEventListener("message", (event) => {
      if (!event.data) return;
      if (event.data.action === "playSound") playNotificationSound();
      if (event.data.action === "navigate" && event.data.url) window.location.href = event.data.url;
    });
  }
}

// ---------------------------
// Attendance prompt UI + logic  ✅ shows ROOM NO.
// ---------------------------
const promptEl = document.getElementById("attendPrompt");
const textEl   = document.getElementById("attendText");
const btnP     = document.getElementById("btnPresent");
const btnA     = document.getElementById("btnAbsent");
let currentClass = null;

function showAttendancePrompt(payload) {
  // Accept payload keys: classId, subject, startTime, classGroup, roomno
  currentClass = payload; // store full payload as received from server
  if (textEl) {
    const roomChunk = payload.roomno ? ` • Room ${payload.roomno}` : "";
    textEl.textContent = `${payload.subject || "Class"} — ${payload.startTime || ""} (${payload.classGroup || ""})${roomChunk}`;
  }
  // also update sidebar small text if present (id: attendTextSide)
  const side = document.getElementById("attendTextSide");
  if (side) side.textContent = textEl ? textEl.textContent : (payload.subject || '');
  if (promptEl) promptEl.style.display = "block";
}
function hideAttendancePrompt() {
  if (promptEl) promptEl.style.display = "none";
  const side = document.getElementById("attendTextSide");
  if (side) side.textContent = "No upcoming class";
  currentClass = null;
}

async function markAttendance(status) {
  const studentStored = JSON.parse(localStorage.getItem("student") || "{}");
  const studentId = localStorage.getItem("studentId") || null;
  const studentEmail = (studentStored && studentStored.email) ? studentStored.email : "";

  if (!currentClass) {
    showToast("No active class to mark.");
    return;
  }
  btnP && (btnP.disabled = true);
  btnA && (btnA.disabled = true);

  try {
    // send studentEmail as 'studentEmail' (backend expects that fallback)
    const res = await fetch(`${API}/attendance/mark`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        studentId,                 // may be null, server will fallback to studentEmail
        studentEmail,
        status,                    // 'present' | 'absent'
        classId: currentClass.classId || currentClass.classId || currentClass._id || currentClass.classId,
        subject: currentClass.subject,
        startTime: currentClass.startTime,
        classGroup: currentClass.classGroup
      })
    });
    const data = await res.json();

    if (!res.ok || (!data.ok && !data.success)) {
      throw new Error(data.message || "Failed to mark attendance");
    }

    // instant local prepend for UX
    const localItem = {
      subject: currentClass.subject,
      classGroup: currentClass.classGroup,
      status,
      markedAt: new Date().toISOString(),
      startTime: currentClass.startTime
    };
    prependRecentAttendance(localItem);

    if (textEl) textEl.textContent = `Marked ${status.toUpperCase()} ✔`;
    setTimeout(() => { hideAttendancePrompt(); refreshSubjectPercent(); }, 900);
  } catch (e) {
    console.error(e);
    if (textEl) textEl.textContent = "Failed to mark, try again";
    btnP && (btnP.disabled = false);
    btnA && (btnA.disabled = false);
    showToast("Mark failed: " + (e.message || ""));
  }
}

btnP && btnP.addEventListener("click", () => markAttendance("present"));
btnA && btnA.addEventListener("click", () => markAttendance("absent"));

// ---------------------------
// Subject-wise attendance %
// ---------------------------
async function loadSubjects(studentId) {
  const subSelect = document.getElementById("subSelect");
  if (!subSelect) return;

  try {
    const res = await fetch(`http://localhost:5000/students/${studentId}/timetable`);
    const classes = await res.json();
    const unique = [...new Set(classes.map(c => c.subject))].filter(Boolean).sort();
    subSelect.innerHTML = "";
    unique.forEach(s => {
      const opt = document.createElement("option");
      opt.value = s; opt.textContent = s;
      subSelect.appendChild(opt);
    });
  } catch (e) {
    subSelect.innerHTML = '<option value="">(failed to load)</option>';
  }
}

async function refreshSubjectPercent() {
  const subSelect   = document.getElementById("subSelect");
  const fromDate    = document.getElementById("fromDate");
  const toDate      = document.getElementById("toDate");
  const subjectStat = document.getElementById("subjectStat");
  const studentId   = localStorage.getItem("studentId");

  if (!subSelect || !subjectStat || !studentId) return;

  const subject = subSelect.value;
  if (!subject) {
    subjectStat.textContent = "—";
    return;
  }

  const params = new URLSearchParams({ studentId, subject });
  if (fromDate?.value) params.append("from", fromDate.value);
  if (toDate?.value)   params.append("to", toDate.value);

  try {
    const res = await fetch(`${API}/attendance/subject-percent?` + params.toString());
    const data = await res.json();
    subjectStat.textContent = `${subject}: ${data.percent ?? 0}%  (Present: ${data.presents ?? 0}/${data.total ?? 0})`;
  } catch (e) {
    subjectStat.textContent = "Failed to load %";
  }
}

// ---------------------------
// Recent Attendance (last 10) + realtime animation
// ---------------------------
async function loadRecentAttendance(studentId) {
  const ul = document.getElementById("att-list");
  if (!ul) return;
  ul.innerHTML = `<li class="att-item">Loading…</li>`;

  try {
    const res = await fetch(`${API}/attendance/recent/${studentId}`);
    if (!res.ok) throw new Error("HTTP " + res.status);
    const rows = await res.json();
    renderRecentAttendance(rows);
  } catch (e) {
    console.error(e);
    ul.innerHTML = `<li class="att-item" style="color:red;">Failed to load</li>`;
  }
}

function renderRecentAttendance(rows) {
  const ul = document.getElementById("att-list");
  if (!ul) return;
  ul.innerHTML = "";
  if (!rows || !rows.length) {
    ul.innerHTML = `<li class="att-item">No records yet</li>`;
    return;
  }

  rows.forEach((r, i) => {
    const li = document.createElement("li");
    li.className = `att-item ${r.status === 'present' ? 'att-present' : 'att-absent'}`;
    li.innerHTML = `
      <div><strong>${r.subject}</strong> (${r.classGroup || "-"}) — <b>${r.status.toUpperCase()}</b></div>
      <div class="meta">${formatDT(r.markedAt)} &middot; ${r.startTime || ""}</div>
    `;
    ul.appendChild(li);
    setTimeout(() => li.classList.add('in'), 30 + i*30);
  });
}

function prependRecentAttendance(item) {
  const ul = document.getElementById("att-list");
  if (!ul) return;

  // create fallback fields if absent
  const it = {
    subject: item.subject || "Unknown",
    classGroup: item.classGroup || "-",
    status: item.status || "absent",
    markedAt: item.markedAt || new Date().toISOString(),
    startTime: item.startTime || ""
  };

  const li = document.createElement("li");
  li.className = `att-item ${it.status === 'present' ? 'att-present' : 'att-absent'}`;
  li.innerHTML = `
    <div><strong>${it.subject}</strong> (${it.classGroup}) — <b>${it.status.toUpperCase()}</b></div>
    <div class="meta">${formatDT(it.markedAt)} &middot; ${it.startTime}</div>
  `;
  ul.prepend(li);
  requestAnimationFrame(() => li.classList.add('in'));

  // keep only last 10
  const nodes = ul.querySelectorAll('.att-item');
  if (nodes.length > 10) ul.removeChild(nodes[nodes.length - 1]);
}

// ---------------------------
// Socket.io listeners  ✅ ROOM NO. in toast & prompt + attendance-updated
// ---------------------------
function initSocketListeners(classGroup) {
  const socket = io("http://localhost:5000", { transports: ["websocket"] });

  socket.on("connect", () => console.log("🟢 Connected to socket.io"));

  socket.on("new-announcement", (data) => {
    playNotificationSound();
    showToast(`📢 ${data.teacherName}: ${data.message}`);
    fetchAnnouncements();
  });

  socket.on("classReminder", (data) => {
    // filter by classGroup (student's section)
    if (!classGroup || data.classGroup === classGroup) {
      playNotificationSound();
      const roomChunk = data.roomno ? ` • Room ${data.roomno}` : "";
      showToast(`🕒 ${data.message}${roomChunk}`);
      // attendance prompt with room
      showAttendancePrompt(data);
    }
  });

  // ✅ Realtime: when teacher saves attendance
  socket.on("attendance-updated", (data) => {
    const myId = String(localStorage.getItem("studentId") || "");
    if (!data) return;
    // server should send studentId as string; compare safely
    if (String(data.studentId) === myId) {
      refreshSubjectPercent();     // update subject-wise %
      prependRecentAttendance(data); // animate into "Recent Attendance"
      showToast(`✅ Attendance updated: ${data.subject} → ${String(data.status).toUpperCase()}`);
    }
  });

  socket.on("timetable-update", (data) => {
    playNotificationSound();
    showToast(`🗓️ ${data.message}`);
  });
}

// ---------------------------
// Toast message
// ---------------------------
function showToast(message) {
  const toast = document.createElement("div");
  toast.textContent = message;
  toast.style.position = "fixed";
  toast.style.bottom = "80px";
  toast.style.right = "20px";
  toast.style.background = "#333";
  toast.style.color = "#fff";
  toast.style.padding = "12px 18px";
  toast.style.fontSize = "15px";
  toast.style.borderRadius = "10px";
  toast.style.boxShadow = "0 3px 10px rgba(0,0,0,0.4)";
  toast.style.zIndex = "9999";
  toast.style.opacity = "0";
  toast.style.transition = "opacity 0.3s ease";
  document.body.appendChild(toast);
  setTimeout(() => (toast.style.opacity = "1"), 80);
  setTimeout(() => {
    toast.style.opacity = "0";
    setTimeout(() => toast.remove(), 300);
  }, 6000);
}
// add near your existing navigator.serviceWorker.message handler

if ('serviceWorker' in navigator) {
  navigator.serviceWorker.addEventListener('message', (event) => {
    if (!event.data) return;
    const { action, payload } = event.data;

    if (action === 'push-received') {
      // play sound (you already have playNotificationSound)
      playNotificationSound();

      // update bell panel: addNotificationToPanel should exist (see snippet below)
      addNotificationToPanel({
        title: payload.title,
        message: payload.message,
        timestamp: payload.timestamp,
        url: payload.url,
        raw: payload.raw
      });

      // optional: sync from server as a fallback
      const sid = localStorage.getItem('studentId');
      if (sid) fetchStoredNotifications(sid);
    }

    if (action === 'navigate' && event.data.url) {
      window.location.href = event.data.url;
    }

    if (action === 'playSound') {
      playNotificationSound();
    }
  });
}
function addNotificationToPanel(n) {
  const drop = document.getElementById('bell-dropdown');
  const badge = document.getElementById('bell-badge');
  if (!drop || !badge) return;

  const when = n.timestamp ? new Date(n.timestamp).toLocaleString() : new Date().toLocaleString();
  const li = document.createElement('li');
  li.innerHTML = `<strong>${escapeHtml(n.title || 'Notification')}</strong><br>${escapeHtml(n.message || '')}<br><small>${when}</small>`;
  drop.prepend(li);

  const cnt = parseInt(badge.textContent || '0', 10) || 0;
  badge.textContent = cnt + 1;
  badge.style.display = 'inline-block';
}
