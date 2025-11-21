document.addEventListener('DOMContentLoaded', () => {

  const container = document.querySelector('.container');
  const LoginLink = document.querySelector('.SignInLink');
  const RegisterLink = document.querySelector('.SignUpLink');

  // Toggle between Login & Register forms
  if (RegisterLink && container) {
    RegisterLink.addEventListener('click', () => container.classList.add('active'));
  }
  if (LoginLink && container) {
    LoginLink.addEventListener('click', () => container.classList.remove('active'));
  }

  console.log("Role-based Login JS Loaded");

  const loginForm = document.getElementById('login-form');
  const emailInput = document.getElementById('email');
  const passwordInput = document.getElementById('password');
  const errorMessage = document.getElementById('error-message');

  // Two different APIs
  const studentLoginApi = 'http://localhost:5000/api/login';
  const teacherLoginApi = 'http://localhost:5000/api/teacher/login';

  if (loginForm) {
    loginForm.addEventListener('submit', async (event) => {
      event.preventDefault();

      const email = emailInput.value.trim();
      const password = passwordInput.value.trim();
      errorMessage.style.display = 'none';

      if (!email || !password) {
        errorMessage.textContent = 'Please fill in all fields.';
        errorMessage.style.display = 'block';
        return;
      }

      try {
        // Try STUDENT login first
        let response = await fetch(studentLoginApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        let data = await response.json();
        console.log("Student login response:", data);

        if (response.ok) {
          localStorage.setItem('studentId', data.studentId);
          localStorage.setItem('role', 'student');
          window.location.href = 'student_dashboard.html';
          return;
        }

        // If not student, try TEACHER login
        response = await fetch(teacherLoginApi, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });

        data = await response.json();
        console.log("Teacher login response:", data);

        if (response.ok) {
          localStorage.setItem('teacherId', data.teacherId);
          localStorage.setItem('teacherName', data.teacherName);
          localStorage.setItem('role', 'teacher');
          window.location.href = 'teacher_dashboard.html';
          return;
        }

        // If both failed
        errorMessage.textContent = data.message || 'Invalid email or password.';
        errorMessage.style.display = 'block';

      } catch (error) {
        console.error('Error during login:', error);
        errorMessage.textContent = 'Could not connect to the server.';
        errorMessage.style.display = 'block';
      }
    });
  } else {
    console.error('Login form not found in the DOM');
  }
});
