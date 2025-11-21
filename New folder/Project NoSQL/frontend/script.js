const publicVapidKey = "BDKgOIWjIj8t0GWfp-0aai7WDgNV8MtRNAiTdM_7D-aXATZai_5WXRbskRaG6YOAsVmqkqwCHrJhw2aS_YcBGb4";

async function subscribeToNotifications() {
  if ('serviceWorker' in navigator) {
    const register = await navigator.serviceWorker.register('/sw.js');

    const subscription = await register.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(publicVapidKey)
    });

    await fetch('http://localhost:5000/api/subscribe', {
      method: 'POST',
      body: JSON.stringify({ subscription, email: "student@gmail.com", name: "John", classGroup: "CSE-A" }),
      headers: { 'Content-Type': 'application/json' }
    });
  }
}

function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - base64String.length % 4) % 4);
  const base64 = (base64String + padding).replace(/\-/g, '+').replace(/_/g, '/');
  const rawData = window.atob(base64);
  return Uint8Array.from([...rawData].map(char => char.charCodeAt(0)));
}

subscribeToNotifications();