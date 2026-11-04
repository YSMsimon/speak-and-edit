import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import "@/styles.css";
import { App } from "@/sidepanel/App";

// The panel is always dark: neon glass on black is the Speak and Edit look.
document.documentElement.classList.add("dark");

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>
);
