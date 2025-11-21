const API_URL = "http://127.0.0.1:5000/api/timetable";

// Add class
document.getElementById("addClassForm").addEventListener("submit", async (e) => {
  e.preventDefault();

  const classData = {
    day: document.getElementById("day").value,
    startTime: document.getElementById("startTime").value,
    endTime: document.getElementById("endTime").value,
    subject: document.getElementById("subject").value,
    roomno: document.getElementById("roomno").value,
    teacher: document.getElementById("teacher").value,
    classGroup: document.getElementById("classGroup").value,
  };

  try {
    const res = await fetch(API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(classData),
    });

    const data = await res.json();
    if (!res.ok) throw new Error(data.message);

    alert("Class added successfully!");
    loadTimetable();
  } catch (err) {
    alert("Error adding class: " + err.message);
  }
});

// Load timetable
async function loadTimetable() {
  try {
    const res = await fetch(API_URL);
    const classes = await res.json();

    const container = document.getElementById("timetableContainer");
    container.innerHTML = "";

    const days = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday"];

    days.forEach(day => {
      const column = document.createElement("div");
      column.className = "day-column";
      column.innerHTML = `<h3>${day}</h3>`;

      const dayClasses = classes.filter(c => c.day === day);
      dayClasses.forEach(c => {
        const card = document.createElement("div");
        card.className = "class-card";
        card.innerHTML = `
  <strong>${c.subject}</strong> (${c.classGroup})<br>
  ${c.startTime} - ${c.endTime}<br>
  ${c.teacher}${c.roomno ? ` — Room ${c.roomno}` : ''} 
  <br>
  <button onclick="deleteClass('${c._id}')">Delete</button>
`;

        column.appendChild(card);
      });

      container.appendChild(column);
    });

  } catch (error) {
    console.error("Error loading timetable:", error);
  }
}

// Delete class
async function deleteClass(id) {
  try {
    await fetch(`${API_URL}/${id}`, { method: "DELETE" });
    loadTimetable();
  } catch (error) {
    alert("Error deleting class");
  }
}

// Initial load
loadTimetable();