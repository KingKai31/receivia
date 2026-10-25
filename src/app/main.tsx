import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/index.css';
import { registerSW } from 'virtual:pwa-register';
import { installGlobalErrorLogging } from '@/lib/errorLog';
import { App } from './App';
import { showUpdateToast } from './updateToast';

import { initMotion } from '@/lib/motion';
registerSW({
  immediate: true,
  onRegisteredSW(_url, reg) {
    // Look for a new deploy when the tab is opened again and every 30 minutes.
    const check = () => void reg?.update().catch(() => undefined);
    document.addEventListener(
      'visibilitychange',
      () => document.visibilityState === 'visible' && check(),
    );
    setInterval(check, 30 * 60 * 1000);
  },
});
showUpdateToast();
installGlobalErrorLogging();
initMotion();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
