/* ===============================
   Smooth scroll to any section
   =============================== */
function scrollToSection(sectionId) {
  // Jo bhi sectionId milega uss section par smooth scroll karega
  document.getElementById(sectionId).scrollIntoView({ behavior: 'smooth' });
}

/* ===============================
   Redirect to Login Page
   =============================== */
function login() {
  // Login page open karega aur query param 'mode=login' bhejega
  window.location.href = "login.html?mode=login";
}

/* ===============================
   Redirect to Register Page
   =============================== */
function register() {
  // Register page open karega aur query param 'mode=register' bhejega
  window.location.href = "Firstpage.html?mode=register";
}

/* ===============================
   Scroll Animation Handler
   Sabhi sections (features, steps, about, cta)
   ko scroll hone par animate karega
   =============================== */
window.addEventListener('scroll', () => {
  // ===== Features Animation =====
  const features = document.querySelectorAll('.feature-card');
  features.forEach(card => {
    const position = card.getBoundingClientRect().top;   // element ka distance viewport se
    const windowHeight = window.innerHeight;             // viewport ki height

    if (position < windowHeight - 100) {
      card.classList.add('show'); // show class add hone se animation chalega
    }
  });

  // ===== How It Works Steps Animation =====
  const steps = document.querySelectorAll('.step');
  steps.forEach(step => {
    const position = step.getBoundingClientRect().top;
    const windowHeight = window.innerHeight;

    if (position < windowHeight - 100) {
      step.classList.add('show');
    }
  });

  // ===== About Section Animation =====
  const aboutSection = document.querySelector('.about');
  if (aboutSection) {
    const position = aboutSection.getBoundingClientRect().top;
    const windowHeight = window.innerHeight;

    if (position < windowHeight - 100) {
      aboutSection.classList.add('show');
    }
  }

  // ===== CTA Section Animation =====
  const ctaSection = document.querySelector('.cta');
  if (ctaSection) {
    const position = ctaSection.getBoundingClientRect().top;
    const windowHeight = window.innerHeight;

    if (position < windowHeight - 100) {
      ctaSection.classList.add('show');
    }
  }
});

/* ===============================
   Page Reload Always Start at Top
   =============================== */
if ("scrollRestoration" in history) {
  history.scrollRestoration = "manual";   // Browser ko bol diya: scroll position yaad mat rakhna
}

// Jaise hi DOM load hota hai turant top par le aao
window.addEventListener("DOMContentLoaded", () => {
  window.scrollTo(0, 0);
});

/* ===============================
   Animate Buttons on Page Load
   =============================== */
window.addEventListener("DOMContentLoaded", () => {
  // Login Button
  const loginBtn = document.querySelector('.btn');
  if (loginBtn) {
    loginBtn.classList.add('animate'); // animate class CSS se animation dega
  }

  // Get Started Button
  const startBtn = document.querySelector('.start-btn');
  if (startBtn) {
    startBtn.classList.add('animate');
  }
});
