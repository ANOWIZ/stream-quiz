import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App.js";
import { DialogProvider } from "./Dialogs.js";
import "./styles.css";
import "./reference.css";
import "./reference-editor.css";
import "./reference-adapter.css";
createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <DialogProvider>
      <App />
    </DialogProvider>
  </React.StrictMode>,
);
