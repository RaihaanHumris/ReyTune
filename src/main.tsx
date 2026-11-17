import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

async function cleanupServiceWorkersAndCaches(): Promise<void> {
  try {
    let hadActiveController = false;
    if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
      hadActiveController = Boolean(navigator.serviceWorker.controller);
      const registrations = await navigator.serviceWorker.getRegistrations();
      if (registrations.length > 0) {
        await Promise.all(
          registrations.map((reg) => reg.unregister().catch(() => false))
        );
      }
    }

    if (typeof window !== 'undefined' && 'caches' in window) {
      const keys = await window.caches.keys();
      await Promise.all(
        keys
          .filter(
            (key) =>
              key.includes('workbox') ||
              key.includes('reytune-audio-streams') ||
              key.includes('reytune-discover-api')
          )
          .map((key) => window.caches.delete(key).catch(() => false))
      );
    }

    // If a stale Service Worker was controlling this document, reload once so Nginx
    // sets the AI Studio auth cookie and requests go directly to the backend.
    if (
      hadActiveController &&
      typeof sessionStorage !== 'undefined' &&
      !sessionStorage.getItem('reytune_sw_evicted_v2')
    ) {
      sessionStorage.setItem('reytune_sw_evicted_v2', '1');
      window.location.reload();
    }
  } catch {
    // Ignore cleanup errors
  }
}

void cleanupServiceWorkersAndCaches();

createRoot(document.getElementById('root')!).render(<App />);
