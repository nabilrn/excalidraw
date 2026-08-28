import React from "react";
import ReactDOM from "react-dom/client";
import "@excalidraw/excalidraw/index.css";
import "./styles.css";
import App from "./App";
import { UtilitySettings } from "./features/settings/UtilitySettings";

ReactDOM.createRoot(document.getElementById("root")!).render(
  <React.StrictMode>
    <App />
    <UtilitySettings />
  </React.StrictMode>,
);
