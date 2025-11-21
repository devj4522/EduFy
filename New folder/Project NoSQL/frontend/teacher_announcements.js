// teacher_announcements.js
const API_BASE = "http://localhost:5000/api";

function fmt(ts){ try{ return new Date(ts).toLocaleString(); }catch{ return '' } }
function escapeHTML(s){ return (s||'').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;'); }

async function loadAnns(){
  const ul = document.getElementById('annModalList');
  if(!ul) return;
  ul.innerHTML = '<li class="muted">Loading…</li>';
  try{
    const r = await fetch(`${API_BASE}/announcements`);
    const data = await r.json();
    ul.innerHTML = '';
    if(!data.length){ ul.innerHTML = '<li class="muted">No announcements yet</li>'; return; }
    data.forEach(a=>{
      const li = document.createElement('li');
      li.className = 'annitem';
      li.innerHTML = `
        <div class="annitem__top">
          <span class="annitem__teacher">${escapeHTML(a.teacherName||'Teacher')}</span>
          <span class="annitem__time">${fmt(a.createdAt)}</span>
        </div>
        <div class="annitem__msg">${escapeHTML(a.message)}</div>`;
      ul.appendChild(li);
    });
  }catch(e){
    ul.innerHTML = '<li class="muted" style="color:#d33">Failed to load</li>';
  }
}
window.loadAnns = loadAnns;
