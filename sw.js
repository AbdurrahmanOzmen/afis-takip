/* Afiş Takip — Web Push service worker */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (_) {
    payload = { body: event.data ? event.data.text() : '' };
  }

  const title = payload.title || 'Afiş Takip Sistemi';
  const options = {
    body: payload.body || 'Yeni bir bildirimin var.',
    icon: new URL('./icon.svg', self.registration.scope).href,
    badge: new URL('./icon.svg', self.registration.scope).href,
    tag: payload.tag || payload.id || 'algida-afis-bildirim',
    data: { url: payload.url || self.registration.scope },
    renotify: false
  };
  event.waitUntil(self.registration.showNotification(title, options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || self.registration.scope, self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await clients.matchAll({ type: 'window', includeUncontrolled: true });
    for (const client of windows) {
      if (client.url.startsWith(self.registration.scope) && 'focus' in client) {
        if ('navigate' in client && client.url !== target) await client.navigate(target);
        return client.focus();
      }
    }
    if (clients.openWindow) return clients.openWindow(target);
  })());
});
