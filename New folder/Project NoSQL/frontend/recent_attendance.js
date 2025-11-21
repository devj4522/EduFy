// recent_attendance.js
const API = "http://localhost:5000/api";
const PAGE_SIZE = 12;

let state = { page: 0, limit: PAGE_SIZE, total: 0, rows: [] };

document.addEventListener("DOMContentLoaded", async () => {
  const studentId = localStorage.getItem("studentId");
  if (!studentId) { alert("Not logged in"); location.href = "login.html"; return; }

  await loadSubjectsForFilter(studentId);
  await loadPage(0);

  document.getElementById("btnSearch").addEventListener("click", ()=> loadPage(0));
  document.getElementById("btnClear").addEventListener("click", clearFilters);
  document.getElementById("prevBtn").addEventListener("click", ()=> loadPage(state.page - 1));
  document.getElementById("nextBtn").addEventListener("click", ()=> loadPage(state.page + 1));

  // realtime socket
  const socket = io("http://localhost:5000", { transports: ["websocket"] });
  socket.on("connect", ()=> console.log("socket connected (recent_attendance)"));
  socket.on("attendance-updated", (payload) => {
    // if payload pertains to this student, refresh current page / or prepend
    if (!payload) return;
    if (String(payload.studentId) === String(studentId)) {
      // optimistic: refresh current page so filters apply
      loadPage(state.page);
    }
  });
});

function getFilters() {
  return {
    subject: document.getElementById("fSubject").value || undefined,
    from: document.getElementById("fFrom").value || undefined,
    to: document.getElementById("fTo").value || undefined,
    status: document.getElementById("fStatus").value || undefined
  };
}

function clearFilters() {
  document.getElementById("fSubject").value = "";
  document.getElementById("fFrom").value = "";
  document.getElementById("fTo").value = "";
  document.getElementById("fStatus").value = "";
  loadPage(0);
}

async function loadSubjectsForFilter(studentId) {
  // get subjects from student's timetable
  try {
    const res = await fetch(`${API}/students/${studentId}/timetable`);
    if (!res.ok) return;
    const classes = await res.json();
    const uniq = [...new Set((classes||[]).map(c=>c.subject).filter(Boolean))].sort();
    const sel = document.getElementById("fSubject");
    sel.innerHTML = "<option value=''>All</option>";
    uniq.forEach(s=>{ const o=document.createElement("option"); o.value=s; o.textContent=s; sel.appendChild(o); });
  } catch(err){ console.error("subjects load failed", err); }
}

async function loadPage(pageIndex=0) {
  const studentId = localStorage.getItem("studentId");
  if (!studentId) return;
  state.page = Math.max(0, pageIndex);
  const { subject, from, to, status } = getFilters();

  const params = new URLSearchParams();
  params.append("studentId", studentId);
  params.append("limit", state.limit);
  params.append("skip", state.page * state.limit);
  if (subject) params.append("subject", subject);
  if (from) params.append("from", from);
  if (to) params.append("to", to);
  if (status) params.append("status", status);

  const tbody = document.getElementById("attBody");
  const totalText = document.getElementById("totalText");
  const pageInfo = document.getElementById("pageInfo");

  tbody.innerHTML = `<tr><td colspan="7" class="empty">Loading…</td></tr>`;
  try {
    const res = await fetch(`${API}/attendance/student?` + params.toString());
    if (!res.ok) throw new Error("HTTP "+res.status);
    const data = await res.json();
    state.rows = data.rows || [];
    state.total = data.total || 0;

    if (!state.rows.length) {
      tbody.innerHTML = `<tr><td colspan="7" class="empty">No records found</td></tr>`;
    } else {
      tbody.innerHTML = "";
      state.rows.forEach((r,i) => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
          <td>${state.page*state.limit + i + 1}</td>
          <td>${escapeHtml(r.subject || "-")}</td>
          <td>${escapeHtml(r.classGroup || "-")}</td>
          <td class="${r.status === 'present' ? 'present' : 'absent'}">${(r.status||"-").toUpperCase()}</td>
          <td>${new Date(r.markedAt).toLocaleString()}</td>
          <td>${r.startTime || ""}</td>
          <td>${escapeHtml(r.teacher || "-")}</td>
        `;
        tbody.appendChild(tr);
      });
    }

    totalText.textContent = `Total: ${state.total}`;
    pageInfo.textContent = `Page ${state.page+1} / ${Math.max(1, Math.ceil(state.total / state.limit))}`;

    document.getElementById("prevBtn").disabled = state.page === 0;
    document.getElementById("nextBtn").disabled = (state.page+1) * state.limit >= state.total;

  } catch (err) {
    console.error(err);
    tbody.innerHTML = `<tr><td colspan="7" class="empty">Failed to load</td></tr>`;
    totalText.textContent = "";
    pageInfo.textContent = "";
  }
}

function escapeHtml(s){ return String(s||"").replaceAll("&","&amp;").replaceAll("<","&lt;").replaceAll(">","&gt;"); }
