import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App';

// 等待 OAuth2 鉴权完成后再渲染 React，避免 OAuth2:ready 事件在 React 监听前触发导致丢失
// window.__OAUTH2_PROMISE__ 由 index.html 中的 initOAuth2() 挂载
const oauth2Promise = window.__OAUTH2_PROMISE__ || Promise.resolve(null);

oauth2Promise.finally(() => {
  const root = ReactDOM.createRoot(document.getElementById('root'));
  root.render(<App />);
});
