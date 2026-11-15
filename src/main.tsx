import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import UiErrorBoundary from "./components/UiErrorBoundary";

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <UiErrorBoundary>
      <App />
    </UiErrorBoundary>
  </StrictMode>,
);
