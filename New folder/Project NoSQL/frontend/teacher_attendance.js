// teacher_attendance.js  — updated
const API = "http://localhost:5000/api";

let TD_cache = { classes: [], byId: {} };
let currentClassId = null;
let roster = [];

const $ = (id) => document.getElementById(id);

// toast
function t(msg){
  const d=document.createElement('div');
  d.textContent=msg;
  d.style.cssText='position:fixed;right:20px;bottom:20px;background:#333;color:#fff;padding:10px 14px;border-radius:10px;box-shadow:0 6px 20px rgba(0,0,0,.25);z-index:9999;opacity:0;transition:opacity .18s';
  document.body.appendChild(d);
  requestAnimationFrame(()=>d.style.opacity='1');
  setTimeout(()=>{d.style.opacity='0';setTimeout(()=>d.remove(),200)},2200);
}

function parseHHMM(s){ if(!s) return {h:0,m:0}; const [h,m]=s.split(':').map(n=>parseInt(n||'0',10)); return {h,m}; }
function isWithinWindow(cls, skewMin=10){
  const now=new Date();
  const {h:sh,m:sm}=parseHHMM(cls.startTime);
  const {h:eh,m:em}=parseHHMM(cls.endTime);
  const start=new Date(now); start.setHours(sh,sm,0,0);
  const end=new Date(now);   end.setHours(eh,em,0,0);
  return now >= new Date(start.getTime()-skewMin*60000) && now <= new Date(end.getTime()+skewMin*60000);
}
function todayName(){ return ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"][new Date().getDay()]; }

// ---- PUBLIC API
async function openAttendance(){
  const panel=$('att-panel');
  if(!panel) return;
  panel.style.display='block';
  await loadTodayClasses();
}
window.openAttendance = openAttendance; // keep global

// ---- load list of today's classes for this teacher
async function loadTodayClasses(){
  const teacherId = localStorage.getItem('teacherId');
  const box = $('att-classes');
  if(!box) return;
  if(!teacherId){ box.innerHTML='<span style="color:red">Login expired. Please re-login.</span>'; return; }

  box.innerHTML='Loading…';
  try{
    const res=await fetch(`${API}/teacher/${teacherId}/timetable`);
    if(!res.ok) throw new Error('HTTP '+res.status);
    const all=await res.json();

    TD_cache.classes=all; TD_cache.byId={};
    all.forEach(c=>TD_cache.byId[c._id]=c);

    const today=todayName().toLowerCase();
    const todayList=(all||[]).filter(c => (c.day||'').toLowerCase()===today);

    if(!todayList.length){ box.innerHTML='<span>No classes today.</span>'; return; }

    box.innerHTML='';
    todayList.forEach(c=>{
      const btn=document.createElement('button');
      btn.textContent = `${c.subject} (${c.classGroup}) ${c.startTime}-${c.endTime}` + (c.roomno?` • Room ${c.roomno}`:'');
      btn.style.margin='6px';
      const open=isWithinWindow(c,10);
      btn.disabled=!open;
      btn.title = open ? 'Take attendance now' : 'Locked (available -10 min to +10 min)';
      btn.onclick=()=>loadRoster(c._id);
      box.appendChild(btn);
    });
  }catch(e){
    console.error('loadTodayClasses error:', e);
    box.innerHTML='<span style="color:red">Failed to load</span>';
  }
}

// ---- load roster for a class
async function loadRoster(classId){
  currentClassId=classId;
  const wrap=$('att-roster-wrap'), tbody=$('att-roster'), title=$('att-class-title');
  if(!wrap||!tbody||!title) return;

  const cls = TD_cache.byId[classId];
  if(!cls){ t('Class not found'); return; }

  wrap.style.display='block';
  tbody.innerHTML='<tr><td colspan="3">Loading roster…</td></tr>';
  title.textContent = `${cls.subject} (${cls.classGroup}) ${cls.startTime}-${cls.endTime}` + (cls.roomno?` • Room ${cls.roomno}`:'');

  try{
    // ✅ cache-buster to avoid old response
    const res=await fetch(`${API}/students?v=2`, { cache: 'no-store' });
    if(!res.ok) throw new Error('HTTP '+res.status);
    const allStudents=await res.json();

    const cg=(cls.classGroup||'').toString().trim().toUpperCase();
    roster = allStudents
      .filter(s => (s.section||'').toString().trim().toUpperCase()===cg)
      .map(s => ({
        _id: s._id,                                       // must exist
        fullName: s.fullName || s.name || 'N/A',
        email: s.email || ''                               // keep email for backend fallback
      }));

    if(!roster.length){ tbody.innerHTML=`<tr><td colspan="3">No students in ${cls.classGroup}</td></tr>`; return; }

    tbody.innerHTML='';
    roster.forEach(s=>{
      const tr=document.createElement('tr');
      tr.innerHTML=`<td>${s.fullName}</td><td>${s.email}</td><td><input type="checkbox" data-id="${s._id}"></td>`;
      tbody.appendChild(tr);
    });
  }catch(e){
    console.error('loadRoster error:', e);
    tbody.innerHTML='<tr><td colspan="3" style="color:red">Failed to load roster</td></tr>';
  }
}

function setPanelBusy(busy){
  const saveBtn = $('save-att');
  const closeBtn= $('close-class');
  if (saveBtn)  saveBtn.disabled  = !!busy;
  if (closeBtn) closeBtn.disabled = !!busy;
}

// ---- save attendance (bulk)
async function saveAttendance(){
  if(!currentClassId) return t('Open a class first');
  const cls = TD_cache.byId[currentClassId];
  const checks=[...document.querySelectorAll('#att-roster input[type="checkbox"]')];
  if(!checks.length) return t('No roster loaded');

  const map={}; roster.forEach(s=>map[s._id]=s);
  let ok=0,fail=0;
  setPanelBusy(true);

  await Promise.all(checks.map(async cb=>{
    const sid = cb.getAttribute('data-id');
    const present = cb.checked;
    const s = map[sid];
    if(!s || !s._id){ console.warn('Missing _id for row', s); fail++; return; }

    const payload = {
      studentId: s._id,                  // primary (ObjectId string)
      studentEmail: s.email,             // ✅ fallback for backend
      status: present ? 'present' : 'absent',
      classId: currentClassId,
      subject: cls.subject,
      startTime: cls.startTime,
      classGroup: cls.classGroup,
    };
    try{
      const res=await fetch(`${API}/attendance/mark`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      const json = await res.json().catch(()=>({}));
      if(!res.ok){ console.error('❌ mark failed', res.status, json); fail++; return; }
      ok++;
    }catch(e){ console.error('❌ network mark failed:', e); fail++; }
  }));

  setPanelBusy(false);
  t(`Saved: ${ok} ✓, Failed: ${fail}`);
}

// ---- close: mark remaining absent
async function closeClass(){
  if(!currentClassId) return t('Open a class first');
  const cls=TD_cache.byId[currentClassId];
  const unchecked=[...document.querySelectorAll('#att-roster input[type="checkbox"]:not(:checked)')];
  if(!unchecked.length) return t('Everyone already present');

  const map={}; roster.forEach(s=>map[s._id]=s);
  let ok=0,fail=0;
  setPanelBusy(true);

  await Promise.all(unchecked.map(async cb=>{
    const sid=cb.getAttribute('data-id');
    const s=map[sid];
    if(!s || !s._id){ console.warn('Missing _id for row', s); fail++; return; }

    const payload={
      studentId: s._id,
      studentEmail: s.email,             // ✅ fallback for backend
      status:'absent',
      classId: currentClassId,
      subject: cls.subject,
      startTime: cls.startTime,
      classGroup: cls.classGroup
    };
    try{
      const res=await fetch(`${API}/attendance/mark`,{
        method:'POST', headers:{'Content-Type':'application/json'}, body:JSON.stringify(payload)
      });
      const json = await res.json().catch(()=>({}));
      if(!res.ok){ console.error('❌ close mark failed', res.status, json); fail++; return; }
      ok++;
    }catch(e){ console.error('❌ network close failed:', e); fail++; }
  }));

  setPanelBusy(false);
  t(`Closed. Auto-ABSENT: ${ok}, Failed: ${fail}`);
}

// ---- button binds
document.addEventListener('DOMContentLoaded',()=>{
  $('mark-all-present') && ($('mark-all-present').onclick = ()=> {
    document.querySelectorAll('#att-roster input[type="checkbox"]').forEach(cb=>cb.checked=true);
  });
  $('save-att')   && ($('save-att').onclick   = saveAttendance);
  $('close-class')&& ($('close-class').onclick= closeClass);
});
