// ============================
// sw.js — EduFy Service Worker (finalized)
// ============================

// 📦 Install
self.addEventListener("install", (ev) => {
  self.skipWaiting();
  console.log("[SW] Installed ✅");
});

// 🚀 Activate
self.addEventListener("activate", (ev) => {
  ev.waitUntil(self.clients.claim());
  console.log("[SW] Activated ✅");
});

// Helper: safe parse (handles JSON/text/malformed payloads)
async function parsePushEventData(event) {
  if (!event.data) return {};
  // try json()
  try {
    return event.data.json();
  } catch (e) {
    // try text() then parse
    try {
      const txt = await event.data.text();
      try { return JSON.parse(txt); } catch (ee) { return { message: txt }; }
    } catch (err) {
      return {};
    }
  }
}

// 🔔 Handle push notifications (from backend / web-push)
self.addEventListener("push", (event) => {
  event.waitUntil((async () => {
    const data = await parsePushEventData(event) || {};
    console.log("[SW] Push Received raw:", data);

    const title = data.title || data.heading || "EduFy Notification";
    const message = data.message || data.body || "You have a new update!";
    const targetUrl = (data.url || data.data?.url) || "C:\Users\Mahak\Documents\Project\New folder\Project NoSQL\frontend\student_dashboard.html";

    // Ensure icon paths are correct relative to your site root.
    // If these files don't exist, browser will gracefully ignore them.
    const options = {
      body: message,
      icon: data.icon || "/images/EduFy.png",
      badge: data.badge || "/images/EduFy.png",
      vibrate: Array.isArray(data.vibrate) ? data.vibrate : [200, 100, 200],
      requireInteraction: data.requireInteraction === undefined ? true : !!data.requireInteraction,
      data: { url: targetUrl, raw: data },
      tag: data.tag || `edufy-${Date.now()}`,
      renotify: data.renotify === undefined ? true : !!data.renotify,
      actions: Array.isArray(data.actions) ? data.actions : undefined
    };

    try {
      console.log("[SW] showing notification:", title, options);
      await self.registration.showNotification(title, options);
      console.log("[SW] showNotification succeeded");

      // Inform open windows so they can update in-app notification panel / play sound
      const clientList = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const client of clientList) {
        try {
          client.postMessage({
            action: "push-received",
            payload: {
              title,
              message,
              url: targetUrl,
              raw: data,
              timestamp: new Date().toISOString()
            }
          });
        } catch (e) {
          console.warn("[SW] failed to postMessage to client", e);
        }
      }
    } catch (err) {
      console.error("[SW] showNotification ERROR:", err);
      // As a fallback, still notify clients so UI can show message inside app
      const clients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      for (const c of clients) {
        try {
          c.postMessage({ action: "push-fallback", payload: { title, message, raw: data } });
        } catch (e) { /* ignore */ }
      }
    }
  })());
});

// 💬 Listen for messages from client (optional commands)
self.addEventListener("message", (event) => {
  if (!event.data) return;
  console.log("[SW] Message from client:", event.data);

  // Example: allow client to ask SW to skipWaiting
  if (event.data && event.data.cmd === "skipWaiting") {
    self.skipWaiting();
  }
});

// 🖱️ Handle notification click
self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  const notifData = event.notification.data || {};
  const targetUrl = notifData.url || "../student_dashboard.html";

  event.waitUntil((async () => {
    try {
      const allClients = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
      if (allClients.length > 0) {
        // prefer focusing a client that already has our app open and can navigate
        let navigated = false;
        for (const client of allClients) {
          // heuristics: same-origin app pages likely contain '/'
          if (client.url && client.url.includes('/')) {
            try {
              await client.focus();
              client.postMessage({ action: "navigate", url: targetUrl });
              navigated = true;
              break;
            } catch (e) {
              console.warn("[SW] client focus/postMessage failed", e);
            }
          }
        }
        if (!navigated) {
          // fallback to first client
          try {
            await allClients[0].focus();
            allClients[0].postMessage({ action: "navigate", url: targetUrl });
          } catch (e) { /* ignore */ }
        }
      } else {
        // no client open — open a new window/tab
        await self.clients.openWindow(targetUrl);
      }
    } catch (err) {
      console.error("[SW] notificationclick handler failed:", err);
    }
  })());
});

// optional: notificationclose (user dismissed)
self.addEventListener("notificationclose", (event) => {
  console.log("[SW] Notification closed:", event.notification?.data);
});
