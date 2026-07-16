import React from "react";
import ReactDOM from "react-dom/client";
import App from "./App";
import { ThemeProvider } from "./hooks/useTheme";
import { FontFamilyProvider } from "./hooks/useFontFamily";
import "./index.css";

ReactDOM.createRoot(document.getElementById("root")).render(
  <React.StrictMode>
    <ThemeProvider>
      <FontFamilyProvider>
        <App />
      </FontFamilyProvider>
    </ThemeProvider>
  </React.StrictMode>
);
