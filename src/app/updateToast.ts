/** Shows a small "Updated, reload" toast when a new service worker takes control of an already open tab. */
export function showUpdateToast(): void {
  if (!('serviceWorker' in navigator)) return;
  const hadController = !!navigator.serviceWorker.controller;
  let shown = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (!hadController || shown) return;
    shown = true;
    const el = document.createElement('div');
    el.setAttribute('role', 'status');
    el.style.cssText =
      'position:fixed;left:16px;right:16px;bottom:16px;z-index:9999;max-width:360px;margin:0 auto;padding:12px 16px;border-radius:12px;background:#18181b;color:#fff;font:14px system-ui;display:flex;gap:12px;align-items:center;justify-content:space-between';
    el.textContent = 'Updated. ';
    const b = document.createElement('button');
    b.textContent = 'Reload';
    b.style.cssText = 'color:#fff;text-decoration:underline;background:none;border:0;font:inherit;cursor:pointer;min-height:32px';
    b.onclick = () => location.reload();
    el.append(b);
    document.body.append(el);
  });
}
