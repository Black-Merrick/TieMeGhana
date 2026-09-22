/**
 * Which device and browser this is, for telling someone how to install the app.
 *
 * Only for that. Chrome and Android offer a real install dialog and the app uses
 * it. Safari on an iPhone or iPad offers none: installing there is the Share
 * button and "Add to Home Screen", done by hand, and only from Safari itself.
 * A patient shown the wrong steps for their own device concludes the app cannot
 * be installed, so which device this is decides what is said.
 */

/** Browsers on iOS that are not Safari. Every one of them draws with WebKit. */
const NOT_SAFARI =
  /CriOS|FxiOS|EdgiOS|OPiOS|OPT\/|DuckDuckGo|GSA\/|FBAN|FBAV|Instagram|Line\/|MicroMessenger|Snapchat|TikTok/i;

export function detectPlatform(nav = typeof navigator === "undefined" ? {} : navigator) {
  const ua = nav.userAgent ?? "";

  // An iPad in its default "desktop site" mode says it is a Mac. It is the
  // touch screen that gives it away.
  const iPadAsMac = nav.platform === "MacIntel" && (nav.maxTouchPoints ?? 0) > 1;
  const ios = /iPhone|iPad|iPod/.test(ua) || iPadAsMac;
  const android = /Android/i.test(ua);

  // Safari names itself twice, as "Version/" and "Safari/". A web view inside
  // another app names neither, and the other browsers name themselves.
  const iosSafari =
    ios && !NOT_SAFARI.test(ua) && /Version\//.test(ua) && /Safari\//.test(ua);

  return { ios, android, iosSafari, iosOther: ios && !iosSafari };
}
