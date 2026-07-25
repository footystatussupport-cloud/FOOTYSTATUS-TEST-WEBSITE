import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import AppErrorBoundary from "./components/AppErrorBoundary.tsx";
import { initializeNativeAuth } from "./lib/nativeAuth.ts";

void initializeNativeAuth().catch((error) => {
  console.error("Unable to initialize native authentication", error);
});

createRoot(document.getElementById("root")!).render(
  <AppErrorBoundary>
    <App />
  </AppErrorBoundary>
);
