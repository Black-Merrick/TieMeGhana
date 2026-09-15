/**
 * Keep the Render service from going to sleep, every five minutes.
 *
 * Render's free tier stops the container after roughly fifteen minutes with no
 * inbound request, and the next request waits thirty to sixty seconds while it
 * starts again. For this app that lands on the worst possible person: a patient
 * who cannot hear taps a sign and nothing happens, with no way to ask why. On a
 * hackathon demo it reads as an app that does not work.
 *
 * Five minutes rather than fourteen. The sleep threshold is approximate and
 * schedulers drift, so a single missed run at fourteen would let it sleep;
 * three chances inside the window is the margin that makes this reliable
 * rather than usually reliable.
 *
 * ## Why here
 *
 * Netlify already builds this repository and already knows the backend's
 * address as API_PROXY_TARGET, so this adds no account, no credential and no
 * second place to keep a URL in step. A GitHub Actions cron was the obvious
 * alternative and is the wrong tool: scheduled workflows there are queued
 * rather than prompt, routinely running ten to thirty minutes late under load,
 * which is exactly the failure this is meant to prevent. They are also
 * disabled automatically after sixty days without a commit, so it would stop
 * working quietly during the one stretch nobody is pushing.
 *
 * ## Why it calls ping and not health
 *
 * `/api/health/` opens a database connection and reads the migration table.
 * Calling that every five minutes would hold the Postgres compute awake around
 * the clock as well, and on a provider that suspends an idle database that
 * spends a free monthly allowance on the monitor rather than on patients. See
 * the view's docstring in backend/core/views.py.
 */

/** Where the Django service lives. The same variable the redirects use. */
const target = (process.env.API_PROXY_TARGET ?? "").trim().replace(/\/+$/, "");

/**
 * Set KEEP_AWAKE=off in the Netlify dashboard to stop the pings.
 *
 * Worth having because staying awake is not free: it consumes Render's
 * monthly instance-hours continuously rather than only while the app is in
 * use. Turning it off should be one setting, not a commit and a redeploy.
 */
const enabled = (process.env.KEEP_AWAKE ?? "on").trim().toLowerCase() !== "off";

export default async () => {
  if (!target) {
    // Said rather than returned quietly. A deploy missing the variable would
    // otherwise show a scheduled function running successfully every five
    // minutes while pinging nothing at all, which is worse than no pinger:
    // the logs say it is working.
    console.error(
      "keep-awake: API_PROXY_TARGET is not set, so there is nothing to ping.",
    );
    return new Response("no target configured", { status: 500 });
  }

  if (!enabled) {
    console.log("keep-awake: disabled by KEEP_AWAKE=off.");
    return new Response("disabled", { status: 200 });
  }

  const url = `${target}/api/ping/`;
  const started = Date.now();

  try {
    // A generous timeout on purpose. If the service has already fallen asleep
    // this request is the one that wakes it, and that takes the better part of
    // a minute: giving up at five seconds would abandon exactly the wake up it
    // was scheduled to perform.
    const response = await fetch(url, {
      signal: AbortSignal.timeout(60_000),
      headers: { "user-agent": "tiemeghana-keep-awake" },
    });

    const elapsed = Date.now() - started;

    if (!response.ok) {
      console.error(`keep-awake: ${url} answered ${response.status} in ${elapsed}ms`);
      return new Response(`upstream ${response.status}`, { status: 502 });
    }

    // The duration is the useful part of this log. A few hundred milliseconds
    // means it was already awake; tens of seconds means it had gone to sleep
    // and this run woke it, which is the signal that the schedule is not
    // keeping up.
    console.log(`keep-awake: ${url} ok in ${elapsed}ms`);
    return new Response("ok", { status: 200 });
  } catch (error) {
    console.error(
      `keep-awake: ${url} failed after ${Date.now() - started}ms:`,
      error instanceof Error ? error.message : error,
    );
    return new Response("unreachable", { status: 502 });
  }
};

export const config = { schedule: "*/5 * * * *" };
