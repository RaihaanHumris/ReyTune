import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const reg of registrations) {
        const scriptUrl =
          reg.active?.scriptURL ||
          reg.waiting?.scriptURL ||
          reg.installing?.scriptURL ||
          '';
        if (
          scriptUrl.includes('dev-sw') ||
          scriptUrl.includes('dev-dist') ||
          scriptUrl.includes('sw.js')
        ) {
          void reg.unregister();
        }
      }
    })
    .catch(() => undefined);
}

if (typeof window !== 'undefined' && 'caches' in window) {
  window.caches
    .keys()
    .then((keys) => {
      for (const key of keys) {
        if (
          key.includes('reytune-audio-streams') ||
          key.includes('workbox-precache')
        ) {
          void window.caches.delete(key);
        }
      }
    })
    .catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(<App />);


