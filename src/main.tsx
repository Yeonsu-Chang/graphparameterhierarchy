import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App";
import './index.css'
// src/main.tsx 상단(React 렌더 전에)
if (import.meta.env.DEV) {
  const s = document.createElement('script');
  s.src = 'https://cdn.tailwindcss.com';
  // 필요하면 preset: s.setAttribute('data-tailwind', '...') 로 config 주입도 가능
  document.head.appendChild(s);
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>
);

