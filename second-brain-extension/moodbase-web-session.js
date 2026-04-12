// Runs on https://moodbase.vercel.app — reads the same Supabase auth entry the web app uses
// and mirrors access/refresh tokens into the extension (via background).

const LOG_PREFIX = "[Moodbase session sync]";
const SB_AUTH_STORAGE_KEY = "sb-qxgsaqvulfafqqxrkyob-auth-token";

console.log(LOG_PREFIX, "content script running", {
  href: typeof location !== "undefined" ? location.href : "(no location)",
  storageKey: SB_AUTH_STORAGE_KEY
});

function logLocalStorageForDebug() {
  const sbKeys = [];
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith("sb-")) sbKeys.push(k);
    }
  } catch (e) {
    console.warn(LOG_PREFIX, "could not enumerate localStorage keys", e?.message || e);
  }
  const raw = (() => {
    try {
      return localStorage.getItem(SB_AUTH_STORAGE_KEY);
    } catch (e) {
      console.warn(LOG_PREFIX, "getItem failed", e?.message || e);
      return null;
    }
  })();
  let parsedOk = false;
  let parsedHasAccess = false;
  let parseError = null;
  if (raw) {
    try {
      const o = JSON.parse(raw);
      parsedOk = true;
      parsedHasAccess = !!(o && typeof o === "object" && o.access_token);
    } catch (e) {
      parseError = e?.message || String(e);
    }
  }
  console.log(LOG_PREFIX, "localStorage", {
    sbDashKeys: sbKeys,
    expectedKeyHit: !!raw,
    rawLength: raw ? raw.length : 0,
    jsonParseOk: parsedOk,
    sessionHasAccessToken: parsedHasAccess,
    parseError
  });
}

function readSupabaseSession() {
  try {
    const raw = localStorage.getItem(SB_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pushSessionToExtension(reason) {
  logLocalStorageForDebug();
  const session = readSupabaseSession();
  const payload = { action: "syncSessionFromWebApp", session };
  console.log(LOG_PREFIX, "sending to background", {
    reason: reason || "unspecified",
    hasSession: !!session,
    hasAccessToken: !!session?.access_token
  });
  chrome.runtime
    .sendMessage(payload)
    .then((response) => {
      console.log(LOG_PREFIX, "background responded OK", {
        reason: reason || "unspecified",
        response: response ?? null
      });
    })
    .catch((err) => {
      console.warn(LOG_PREFIX, "sendMessage to background failed", {
        reason: reason || "unspecified",
        message: err?.message || String(err)
      });
    });
}

pushSessionToExtension("initial");
setInterval(() => pushSessionToExtension("interval"), 25000);

window.addEventListener("storage", (e) => {
  if (e.key === SB_AUTH_STORAGE_KEY) pushSessionToExtension("storage");
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "readSupabaseSession") {
    sendResponse(readSupabaseSession());
    return true;
  }
});
