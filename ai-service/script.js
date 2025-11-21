// Ai-service FINAL UPDATED script.js
// Handles: tasks, progress, chats, AI plan, student‑specific data

const API_BASE = 'http://localhost:5001';
const STUDENT_USER = window.MENTOR_USER || 'guest_user';
const STUDENT_NAME = window.MENTOR_NAME || 'Guest';

// optionally read initial tasks
const initialTasks = JSON.parse(localStorage.getItem('mentor_initial_tasks') || '[]');
if(initialTasks.length){
  // show in UI or save to backend
  fetch(`${API_BASE}/tasks`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user: STUDENT_USER, tasks: initialTasks }) }).catch(()=>{});
}
const initialProgress = JSON.parse(localStorage.getItem('mentor_initial_progress') || '{}');
if(initialProgress.total || initialProgress.completed){
  fetch(`${API_BASE}/progress`, { method:'POST', headers:{'Content-Type':'application/json'}, body: JSON.stringify({ user: STUDENT_USER, completed: initialProgress.completed || 0, total: initialProgress.total || 0 }) }).catch(()=>{});
}

// --- Identify current logged-in student (coming from Student Dashboard) ---
const CURRENT_USER =
  localStorage.getItem('ai_student_userid') ||
  localStorage.getItem('ai_student_name') ||
  'guest_user';

console.log("AI Mentor Loaded for User:", CURRENT_USER);

// --- Utilities ---
function el(id){ return document.getElementById(id); }
function formatPercent(n){ return Math.round(n) + '%'; }
function nowISO(){ return new Date().toISOString(); }

// --- State ---
let tasks = []; // {id,title,duration,done}
let progress = { completed:0, total:0 };

// --- Render Tasks ---
function renderTasks(){
  const list = el('taskList');
  if(!list) return;

  list.innerHTML = '';
  tasks.forEach(t => {
    const li = document.createElement('li');
    li.className = 'task-item';
    li.innerHTML = `
      <div class="left">
        <input type="checkbox" ${t.done?'checked':''} onchange="toggleTask('${t.id}')" />
        <div>
          <div class="task-title">${t.title}</div>
          <div class="muted small">Est ${t.duration} mins</div>
        </div>
      </div>
      <div class="task-actions">
        <button onclick="removeTask('${t.id}')">🗑</button>
      </div>`;
    list.appendChild(li);
  });

  updateProgress();

  // subtle animation
  list.animate([
    {opacity:0, transform:'translateY(6px)'},
    {opacity:1, transform:'translateY(0)'}
  ], {duration:300, easing:'ease-out'});
}

function addTaskPrompt(){
  const title = prompt('Enter task title:');
  if(!title) return;
  const duration = parseInt(prompt('Minutes required?','20')) || 20;
  addTask({title,duration});
}

function addTask(task){
  const id = 't' + Date.now();
  tasks.push({ id, title: task.title, duration: task.duration || 20, done:false });
  renderTasks();
  saveTasks();
}

function removeTask(id){
  tasks = tasks.filter(t => t.id !== id);
  renderTasks();
  saveTasks();
}

function clearTasks(){
  if(!confirm('Clear all tasks?')) return;
  tasks = [];
  renderTasks();
  saveTasks();
}

function toggleTask(id){
  tasks = tasks.map(t => t.id === id ? {...t, done:!t.done} : t);
  renderTasks();
  saveTasks();
  saveProgress();
}

// --- Progress ---
function updateProgress(){
  const total = tasks.length || 1;
  const completed = tasks.filter(t => t.done).length;

  progress.total = total;
  progress.completed = completed;

  const pct = Math.round((completed / total) * 100);
  el('progressBar').style.width = pct + '%';
  el('progressText').textContent = pct + '% completed';
}

// --- Backend Persistence ---
async function saveTasks(){
  try{
    await fetch(`${API_BASE}/tasks`, {
      method: 'POST',
      headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ user: CURRENT_USER, tasks, updatedAt: nowISO() })
    });
  }catch(e){ console.warn('saveTasks failed', e); }
}

async function loadTasks(){
  try{
    const res = await fetch(`${API_BASE}/tasks?user=${encodeURIComponent(CURRENT_USER)}`);
    const data = await res.json();
    if(data.tasks) tasks = data.tasks;
  }catch(e){ console.warn('loadTasks failed', e); }
  renderTasks();
}

async function saveProgress(){
  try{
    const res = await fetch(`${API_BASE}/progress`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({
        user: CURRENT_USER,
        completed: progress.completed,
        total: progress.total,
        timestamp: nowISO()
      })
    });
    const data = await res.json();
    if(data.plan) applyPlan(data.plan);
  }catch(e){ console.warn('saveProgress failed', e); }
}

async function loadProgress(){
  try{
    const res = await fetch(`${API_BASE}/progress?user=${encodeURIComponent(CURRENT_USER)}`);
    const data = await res.json();
    if(data.progress){
      progress = data.progress;
      updateProgress();
    }
  }catch(e){ console.warn('loadProgress failed', e); }
}

// --- Study Plan ---
function applyPlan(plan){
  el('planSummary').innerHTML = `<strong>Plan:</strong><br>${plan.summary || 'No summary'}`;
  el('planSummary').animate([{opacity:0},{opacity:1}],{duration:350});
}

async function regeneratePlan(){
  try{
    el('planSummary').textContent = 'Generating plan...';
    const res = await fetch(`${API_BASE}/generate-plan`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user: CURRENT_USER, tasks, progress })
    });
    const data = await res.json();
    if(data.plan) applyPlan(data.plan);
    else el('planSummary').textContent = 'Unable to generate plan.';
  }catch(e){
    console.warn('regeneratePlan failed', e);
    el('planSummary').textContent = 'Plan generation error.';
  }
}

// --- Chat System ---
async function sendMessage(){
  const input = el('prompt');
  const text = input.value.trim();
  if(!text) return;

  const messages = el('messages');
  const userDiv = document.createElement('div');
  userDiv.className = 'msg user';
  userDiv.textContent = text;
  messages.appendChild(userDiv);
  messages.scrollTop = messages.scrollHeight;

  input.value = '';

  const temp = document.createElement('div');
  temp.className = 'msg ai';
  temp.textContent = 'Typing...';
  messages.appendChild(temp);
  messages.scrollTop = messages.scrollHeight;

  try{
    const res = await fetch(`${API_BASE}/chat`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user: CURRENT_USER, prompt: text })
    });
    const data = await res.json();
    temp.textContent = data.reply || 'No response';

    // save chat record
    await fetch(`${API_BASE}/chats`, {
      method:'POST', headers:{'Content-Type':'application/json'},
      body: JSON.stringify({ user: CURRENT_USER, prompt: text, reply: data.reply })
    });
  }catch(err){
    temp.textContent = 'Error connecting to backend';
    console.error(err);
  }

  pulseAnimation();
}

document.getElementById('sendBtn').addEventListener('click', sendMessage);
document.getElementById('prompt').addEventListener('keypress', e =>
  { if(e.key === 'Enter') sendMessage(); }
);

// --- Pulse Animation ---
function pulseAnimation(){
  const dots = document.querySelectorAll('.dot');
  dots.forEach(d => d.animate([
    {transform:'scale(1)'},
    {transform:'scale(1.3)'},
    {transform:'scale(1)'}
  ], {duration:600, iterations:1}));
}

// --- INIT ---
async function init(){
  await loadTasks();
  await loadProgress();

  document.querySelectorAll('.card').forEach((c,i)=>
    c.animate([
      {opacity:0, transform:'translateY(8px)'},
      {opacity:1, transform:'translateY(0)'}
    ], {duration:450, delay:i*70})
  );
}
init();