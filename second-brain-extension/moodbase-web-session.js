// Runs on https://moodbase.vercel.app — reads the same Supabase auth entry the web app uses
// and mirrors access/refresh tokens into the extension (via background).

const SB_AUTH_STORAGE_KEY = "sb-qxgsaqvulfafqqxrkyob-auth-token";

function readSupabaseSession() {
  try {
    const raw = localStorage.getItem(SB_AUTH_STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

function pushSessionToExtension() {
  const session = readSupabaseSession();
  chrome.runtime.sendMessage({ action: "syncSessionFromWebApp", session }).catch(() => {});
}

pushSessionToExtension();
setInterval(pushSessionToExtension, 25000);

window.addEventListener("storage", (e) => {
  if (e.key === SB_AUTH_STORAGE_KEY) pushSessionToExtension();
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg.action === "readSupabaseSession") {
    sendResponse(readSupabaseSession());
    return true;
  }
});
