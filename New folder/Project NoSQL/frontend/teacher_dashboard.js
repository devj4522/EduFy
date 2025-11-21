const API = "http://localhost:5000/api";

document.addEventListener("DOMContentLoaded", async () => {
  const teacherId = localStorage.getItem("teacherId");
  if (!teacherId) return (window.location.href = "login.html");

  const res = await fetch(`${API}/teacher/${teacherId}`);
  const teacher = await res.json();

  document.getElementById("teacherName").textContent =
    `Welcome, ${teacher.name} 👨‍🏫`;
});

function logout() {
  localStorage.removeItem("teacherId");
  window.location.href = "login.html";
}
