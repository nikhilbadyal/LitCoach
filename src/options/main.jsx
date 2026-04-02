import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@options/App.jsx";
import { GoogleAuth } from "@/components/google-auth";
import { Toaster } from "@components/ui/toaster";
// ThemeProvider at root so auth loading/sign-in screens also respect dark mode
import { ThemeProvider } from "@/components/theme-provider";
import "@styles/index.css";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        {/* Wrap everything so every screen (auth, options) gets dark mode */}
        <ThemeProvider defaultTheme="system" storageKey="litcoach-theme">
            <GoogleAuth>
                <App />
            </GoogleAuth>
            <Toaster />
        </ThemeProvider>
    </StrictMode>,
);
