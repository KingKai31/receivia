import React from 'react';
import ReactDOM from 'react-dom/client';
import '@/styles/index.css';
import { registerSW } from 'virtual:pwa-register';
import { installGlobalErrorLogging } from '@/lib/errorLog';
import { App } from './App';

registerSW({ immediate: true });
installGlobalErrorLogging();

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
