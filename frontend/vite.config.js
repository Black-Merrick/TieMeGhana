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

        // Without this the plugin generates nothing during `npm run dev`: no
        // manifest, no service worker, and therefore no install prompt, since
        // a browser will not offer to install a page that does not claim to be
        // an app. Requests for /manifest.webmanifest fell through to Vite's
        // SPA fallback and returned index.html with a 200, which is the most
        // confusing possible answer: everything looked wired up and nothing
        // was. Enabled so that installing can be tested where it is built.
        devOptions: { enabled: true, type: "module" },

        // The plugin adds every manifest icon to the precache by default,
        // which put the 512px icon back in after globIgnores had taken it out.
        // The operating system fetches that one when the app is installed, an
        // action that needs a connection anyway, so it does not have to be
        // downloaded before the app will open for the first time.
        includeManifestIcons: false,
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
            // Derived from public/icon.png by tools/build_icons.py. Two sizes,
            // which is what a manifest is expected to carry.
            {
              src: "icon-192.png",
              sizes: "192x192",
              type: "image/png",
              purpose: "any",
            },
            {
              src: "icon-512.png",
              sizes: "512x512",
              type: "image/png",
              // Deliberately not "maskable". A launcher crops a maskable icon
              // to its own rounded shape, and this logo already has one of its
              // own, so declaring it maskable would round the corners twice
              // and clip the artwork inside them.
              purpose: "any",
            },
          ],
        },
        workbox: {
          // GhSL clips are the expensive asset. Cache them aggressively so a
          // prescription playlist replays at home with no connection, FR 6.2.
          globPatterns: ["**/*.{js,css,html,svg,png,woff2}"],

          // The large icons and the stray screenshot are not needed offline,
          // and precaching them cost around 590 kB on the first visit: the
          // 512px icon is fetched by the operating system at install time,
          // which needs a connection anyway, and the 250 kB source is only
          // there for tools/build_icons.py to derive the rest from. NFR 5 is
          // about a hospital connection, so what is not needed offline should
          // not be downloaded before the app will open.
          globIgnores: ["icon.png", "icon-512.png", "screen.png", "icons.svg"],
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
            {
              // The playlist itself, FR 6.2. Without this the clips are cached
              // but the list naming them is not, so an offline patient has
              // every video on the phone and no way to reach them.
              //
              // NetworkFirst, not CacheFirst: a sign a consultant withdraws
              // has to stop playing, per ADR 043, and CacheFirst would keep
              // serving the old playlist indefinitely. This way an online
              // patient always gets the current rendering and an offline one
              // gets the last one they saw. Offline replay does mean a
              // withdrawn sign can still play until the phone next has signal;
              // that is the unavoidable cost of the requirement, and the whole
              // reason the sequence is resolved server side on every read.
              urlPattern: /\/api\/prescriptions\/[^/]+\/$/,
              handler: "NetworkFirst",
              options: {
                cacheName: "prescription-playlists",
                networkTimeoutSeconds: 5,
                expiration: { maxEntries: 20 },
                cacheableResponse: { statuses: [200] },
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
