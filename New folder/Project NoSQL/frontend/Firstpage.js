const container = document.querySelector('.container');
const LoginLink = document.querySelector('.SignInLink');
const RegisterLink = document.querySelector('.SignUpLink');
//----------Confirmation POP Before going to Home Screen--------
document.addEventListener('DOMContentLoaded', () => {
  const backHomeLink = document.querySelector('.back-home a');

  backHomeLink.addEventListener('click', (e) => {
    const confirmLeave = confirm("Are you sure you want to go back to Home?");
    if (!confirmLeave) {
      e.preventDefault(); // Cancel navigation
    }
  });
});
// ----------- 1. Toggle Feature (Sign In / Sign Up clicks) -----------
RegisterLink.addEventListener('click', () => {
    container.classList.add('active'); // Register form show
});

LoginLink.addEventListener('click', () => {
    container.classList.remove('active'); // Login form show
});

// ----------- 2. URL Parameter Feature (Default form on page load) -----------
document.addEventListener('DOMContentLoaded', () => {
    const urlParams = new URLSearchParams(window.location.search);
    const mode = urlParams.get('mode'); // 'login' ya 'register'

    if (mode === 'register') {
        // Agar URL me mode=register ho, to Register form show kare
        container.classList.add('active');
    } else {
        // Default: Login form show kare
        container.classList.remove('active');
    }
});