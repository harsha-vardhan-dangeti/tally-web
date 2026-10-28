import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { ErrorBoundary } from "./ui/ErrorBoundary";
import { registerServiceWorker } from "./data/updates";
import { completeSignInRedirect } from "./data/cloud";
import "@fontsource-variable/hanken-grotesk";
import "@fontsource-variable/bricolage-grotesque";
import "./styles.css";

// Coming back from Google: finish signing in before the app reads the address bar.
void completeSignInRedirect().finally(() => {
  createRoot(document.getElementById("root")!).render(
    <StrictMode>
      <ErrorBoundary>
        <App />
      </ErrorBoundary>
    </StrictMode>,
  );
});

// Offline support and in-place updates.
registerServiceWorker();
