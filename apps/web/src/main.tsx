import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import "./styles.css";
import "./readability.css";
import "./workflow.css";
import "./documents.css";
import "./library.css";
import "./creation.css";
import "./onboarding.css";
import "./refinement.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
