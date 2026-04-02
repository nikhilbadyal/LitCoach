import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "@sidepanel/App.jsx";
import { GoogleAuth } from "@/components/google-auth";
import { Toaster } from "@components/ui/toaster";
// ThemeProvider lives at the root so ALL screens (auth loading, invalid page, chat) respect dark mode
import { ThemeProvider } from "@/components/theme-provider";
import "@styles/index.css";

createRoot(document.getElementById("root")).render(
    <StrictMode>
        {/* Wrap the entire tree so every screen gets light/dark/system theme support */}
        <ThemeProvider defaultTheme="system" storageKey="litcoach-theme">
            <GoogleAuth>
                <App />
            </GoogleAuth>
            <Toaster />
        </ThemeProvider>
    </StrictMode>,
);
