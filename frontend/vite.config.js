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

          // Addresses the service worker must not answer with the app's own
          // index.html.
          //
          // Workbox registers a navigation fallback so that a deep link into
          // the app, /p/<reference> from a scanned QR code, works offline and
          // on a hard refresh. That fallback matches *every* navigation,
          // including ones that were never app routes, and the failure is
          // silent and total: the address bar shows the file you asked for and
          // the browser renders the patient app instead.
          //
          // It is invisible from a terminal, because curl has no service
          // worker, and invisible in development, where these paths are
          // proxied to Django before a worker sees them. It showed up on a
          // phone, where the user manual opened as a blank screen.
          //
          // The app's own routes are deliberately absent from this list. "/",
          // "/privacy", "/terms" and "/p/<reference>" must keep falling back to
          // index.html or a reload of any of them breaks offline.
          navigateFallbackDenylist: [
            // Proxied to Django. The admin is how a consultant approves clips,
            // and answering it with the patient screen is the exact confusion
            // the dev server proxy exists to prevent.
            /^\/api\//,
            /^\/admin\//,
            /^\/static\//,
            /^\/media\//,
            // Real files served from the build, the user manual among them. A
            // prescription reference is url safe base64 and never contains a
            // dot, so a dot in the path means a file rather than a route.
            /\.[a-z0-9]+$/i,
          ],

          runtimeCaching: [
            {
              // Sign videos, FR 6.2.
              //
              // Matched on the file rather than on a path prefix, with or
              // without a `/media/` in front: a bucket serves `/clips/x.mp4`
              // and Django or nginx serve `/media/clips/x.mp4`. The rule
              // used to be /\/media\/clips\/, which was correct while media
              // was served by Django from MEDIA_URL and silently stopped
              // matching anything when it moved to a bucket under ADR 050: the
              // URL became https://pub-....r2.dev/clips/appear.mp4, with no
              // /media/ segment in it. Nothing failed. Offline replay simply
              // stopped working, which is exactly the kind of quiet regression
              // a cache rule invites.
              //
              // But not every request for one. A video element on a page asks
              // a cross origin server for a clip in `no-cors` mode, and a
              // service worker that answers that request can only ever pass on
              // an opaque response, which it cannot cut into the byte ranges
              // the element then asks for. Real Chrome, real bucket: through
              // this rule the clip stalled or failed with "the sign video did
              // not load"; with the service worker out of the way it played
              // every time. So a cross origin `no-cors` request is not this
              // rule's to answer, and the browser makes it as if there were no
              // service worker. Same origin requests, and cross origin ones
              // made with CORS (the warm up's), are ordinary and are cached.
              urlPattern: ({ url, request, sameOrigin }) =>
                /\.(mp4|webm)$/i.test(url.pathname) &&
                /^\/(media\/)?(clips|stitched)\//.test(url.pathname) &&
                (sameOrigin || request.mode !== "no-cors"),
              handler: "CacheFirst",
              options: {
                // Versioned: see MEDIA_CACHE in signs/precacheClips.js, which
                // this must equal, and why the old name was abandoned.
                cacheName: "ghsl-media-v2",
                expiration: {
                  maxEntries: 300,
                  maxAgeSeconds: 60 * 60 * 24 * 30,
                },
                // 200 only. An opaque response (status 0) is never kept, and a
                // 206 is not either: a partial body cached as though it were
                // the whole file is another way to the same failure.
                cacheableResponse: { statuses: [200] },
                // What lets a whole file that was cached answer the byte range
                // a video element asks for, instead of returning all of it to
                // a request for part.
                rangeRequests: true,
              },
            },
            {
              // Medicine photographs, FR 6.2. Kept apart from the videos
              // because an opaque response is fine for a picture: an image
              // element wants the whole file and never a range, so the
              // cross origin no-cors responses that must not be kept for
              // videos are kept here, and status 0 is accepted on purpose.
              urlPattern: ({ url }) =>
                /\.(jpg|jpeg|png)$/i.test(url.pathname) &&
                /^\/(media\/)?medicines\//.test(url.pathname),
              handler: "CacheFirst",
              options: {
                cacheName: "ghsl-images",
                expiration: {
                  maxEntries: 300,
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
