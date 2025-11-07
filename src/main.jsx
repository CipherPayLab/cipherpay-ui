import React from 'react';
import ReactDOM from 'react-dom/client';
import './index.css';

console.log('[main.jsx] Starting app...');
console.log('[main.jsx] React:', React);
console.log('[main.jsx] ReactDOM:', ReactDOM);

const rootElement = document.getElementById('root');
if (!rootElement) {
  console.error('[main.jsx] Root element not found!');
} else {
  console.log('[main.jsx] Root element found:', rootElement);
}

try {
  const root = ReactDOM.createRoot(rootElement);
  
  // Try to import App - catch any import errors
  import('./App').then(({ default: App }) => {
    console.log('[main.jsx] App component loaded:', App);
    root.render(
      <React.StrictMode>
        <App />
      </React.StrictMode>
    );
    console.log('[main.jsx] App rendered');
  }).catch((error) => {
    console.error('[main.jsx] Error loading App:', error);
    root.render(
      <div style={{ padding: '20px', color: 'red' }}>
        <h1>Error Loading App</h1>
        <pre>{error.toString()}</pre>
        <pre>{error.stack}</pre>
      </div>
    );
  });
} catch (error) {
  console.error('[main.jsx] Error creating root:', error);
  if (rootElement) {
    rootElement.innerHTML = `
      <div style="padding: 20px; color: red;">
        <h1>Fatal Error</h1>
        <pre>${error.toString()}</pre>
        <pre>${error.stack}</pre>
      </div>
    `;
  }
}


