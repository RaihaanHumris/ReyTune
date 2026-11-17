import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';

if (typeof navigator !== 'undefined' && 'serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((registrations) => {
      for (const reg of registrations) {
        const scriptUrl = reg.active?.scriptURL || reg.installing?.scriptURL || '';
        if (scriptUrl.includes('dev-dist') || scriptUrl.includes('sw.js')) {
          void reg.update();
        }
        if (scriptUrl.includes('dev-dist')) {
          void reg.unregister();
        }
      }
    })
    .catch(() => undefined);
}

createRoot(document.getElementById('root')!).render(<App />);

