import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { crx } from "@crxjs/vite-plugin";
import { resolve, dirname } from "path";
import { fileURLToPath } from "url";
import fs from "fs";

const __dirname = dirname(fileURLToPath(import.meta.url));

const { version, description } = JSON.parse(fs.readFileSync("package.json", "utf-8"));

const getManifest = (env) => ({
    manifest_version: 3,
    name: "LitCoach",
    oauth2: {
        client_id: env.VITE_GOOGLE_CLIENT_ID || "883873953277-b3qo34v2o0tnhpe8uiprt10uguv8nog1.apps.googleusercontent.com",
        scopes: ["openid"],
    },
    permissions: ["sidePanel", "tabs", "scripting", "activeTab", "storage", "identity", "identity.email", "alarms"],
    icons: {
        16: "icon16.png",
        32: "icon32.png",
        48: "icon48.png",
        128: "icon128.png",
    },
    action: {},
    options_page: "src/options/index.html",
    side_panel: { default_path: "src/sidepanel/index.html" },
    background: { service_worker: "src/background/background.js", type: "module" },
    host_permissions: ["https://leetcode.com/*"],
    browser_specific_settings: {
        gecko: {
            id: "litcoach@rezabrizi.github.io", // Required for static OAuth Redirect URIs in Firefox!
            strict_min_version: "109.0" // Required for MV3 Service Workers
        }
    },
    key: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAtSMOjksdInySjNETVumZ/ref2oP3a80D5EAN+HjqKrvivZyVQF9cLOgtUCOnLch0ZcaSeJwTd0QuO0/Ol/8G805NuE1k153ATUBRsCGyUUhG6/0Pb/WZ4f5xx0H0M8HXUSlonf6zZc+ao/0iAwnq7e9uzLBGWV+auT1iZe59zTYkD+ykp0WloEjfsNJtEcS6ORInzIS5KY6O9Wz5GCwRZGsA8KWOZ54JrQSKAhr9pDAdAEWEodCwiC7+iapr5kIEPaS7l+rl5fKe+GoTL/AKh5u3CnXW66y0comSW4YsJMU1iP6u28gy8GbCtkbmvc+XZ++jGTAaxwLmHXRTyQIqpQIDAQAB",
    version,
    description,
});

const srcDir = resolve(__dirname, "src");

export default defineConfig(({ mode }) => {
    const env = loadEnv(mode, process.cwd(), '');
    return {
        plugins: [react(), crx({ manifest: getManifest(env) })],
        server: {
            strictPort: true,
            port: 5173,
            hmr: { clientPort: 5173 },
        },
        resolve: {
            alias: {
                "@": srcDir,
                "@styles": `${srcDir}/styles`,
                "@hooks": `${srcDir}/hooks`,
                "@components": `${srcDir}/components`,
                "@options": `${srcDir}/options`,
                "@sidepanel": `${srcDir}/sidepanel`,
            },
        },
    };
});
