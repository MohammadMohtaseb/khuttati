import React from 'react';
import {createRoot} from 'react-dom/client';
import App from './PublicApp';
import './styles.css';
import {initStore} from './store';
initStore();
createRoot(document.getElementById('root')).render(<App/>);
// The public site never caches private plan modules or authenticated files.
if('serviceWorker' in navigator)navigator.serviceWorker.getRegistrations().then(items=>items.forEach(item=>item.unregister())).catch(()=>{});
