import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv } from "vite";
import { VitePWA } from "vite-plugin-pwa";

// NFR 5 requires the app to stay usable under intermittent connectivity in
// Ghanaian hospitals, so the PWA service worker is part of the build from the
// first commit rather than bolted on at the end.
export default defineConfig(({ mode }) => {
  // loadEnv, not process.env: a Vite config runs before .env files are applied
  // to the process, so process.env would silently ignore .env.local and the
  // proxy would quietly point at the wrong port.
  const env = loadEnv(mode, process.cwd(), "VITE_");

  // The backend port is configurable because a developer may already have
  // another Django project holding the default 8000.
  const apiProxyTarget = env.VITE_API_PROXY_TARGET ?? "http://localhost:8000";

  return {
    // Proxying in development mirrors what nginx does in the containerized
    // stack, so the frontend uses one relative path everywhere and a CORS or
    // absolute URL problem cannot appear only in deployment.
    //
    // /admin and /static are proxied for a sharper reason: without them the
    // SPA fallback answers /admin with the React app and a 200, so someone
    // looking for the Django admin gets the patient screen and no error to
    // explain it. nginx already proxies /admin, so this is dev catching up.
    server: {
      proxy: {
        "/api": { target: apiProxyTarget, changeOrigin: true },
        "/media": { target: apiProxyTarget, changeOrigin: true },
        "/admin": { target: apiProxyTarget, changeOrigin: true },
        "/static": { target: apiProxyTarget, changeOrigin: true },
      },
    },

    plugins: [
      react(),
      VitePWA({
        registerType: "autoUpdate",
        manifest: {
          name: "Tie Me Ghana",
          short_name: "Tie Me Ghana",
          description:
            "Hospital communication for Deaf and Hard of Hearing patients in Ghana.",
          theme_color: "#0b3d2e",
          background_color: "#ffffff",
          display: "standalone",
          start_url: "/",
          icons: [
            {
              src: "icon.svg",
              sizes: "any",
              type: "image/svg+xml",
              purpose: "any maskable",
            },
          ],
        },
        workbox: {
          // GhSL clips are the expensive asset. Cache them aggressively so a
          // prescription playlist replays at home with no connection, FR 6.2.
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],
          runtimeCaching: [
            {
              urlPattern: /\/media\/clips\/.*\.(mp4|webm)$/,
              handler: "CacheFirst",
              options: {
                cacheName: "ghsl-clips",
                expiration: {
                  maxEntries: 200,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                cacheableResponse: { statuses: [0, 200] },
              },
            },
          ],
        },
      }),
    ],

    test: {
      environment: "jsdom",
      globals: true,
      setupFiles: "./src/setupTests.js",
      css: false,
    },
  };
});
