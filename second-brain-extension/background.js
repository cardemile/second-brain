// ─── Moodbase — Background Service Worker (Supabase Edition) ─────────────
// RLS requires a logged-in JWT on REST calls. Session is stored in chrome.storage
// after Google sign-in (PKCE). Add chrome.identity.getRedirectURL() to Supabase
// Dashboard → Authentication → URL Configuration → Redirect URLs.

const SUPABASE_URL = "https://qxgsaqvulfafqqxrkyob.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z3NhcXZ1bGZhZnFxeHJreW9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDY5MzUsImV4cCI6MjA5MTIyMjkzNX0.ScmKdK5dI8xBv-35r0Zx0GwqyCVWT9MsqnIKlM7GGWg";

const SB_ACCESS = "sb_access_token";
const SB_REFRESH = "sb_refresh_token";
const SB_EXPIRES = "sb_expires_at";
const SB_EMAIL = "sb_user_email";

const authJsonHeaders = {
  "Content-Type": "application/json",
  "apikey": SUPABASE_KEY,
  "Authorization": `Bearer ${SUPABASE_KEY}`
};

function generateCodeVerifier() {
  const pool = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  const bytes = new Uint8Array(64);
  crypto.getRandomValues(bytes);
  let s = "";
  for (let i = 0; i < 64; i++) s += pool[bytes[i] % pool.length];
  return s;
}

async function sha256Base64Url(plain) {
  const data = new TextEncoder().encode(plain);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = new Uint8Array(hash);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function persistSessionFromAuthResponse(body) {
  const exp = Math.floor(Date.now() / 1000) + (body.expires_in || 3600);
  await chrome.storage.local.set({
    [SB_ACCESS]: body.access_token,
    [SB_REFRESH]: body.refresh_token,
    [SB_EXPIRES]: exp,
    [SB_EMAIL]: body.user?.email || null
  });
}

async function clearStoredSession() {
  await chrome.storage.local.remove([SB_ACCESS, SB_REFRESH, SB_EXPIRES, SB_EMAIL]);
}

async function getValidAccessToken() {
  const stored = await chrome.storage.local.get([SB_ACCESS, SB_REFRESH, SB_EXPIRES]);
  const now = Date.now() / 1000;
  if (stored[SB_ACCESS] && stored[SB_EXPIRES] && stored[SB_EXPIRES] > now + 90) {
    return stored[SB_ACCESS];
  }
  if (!stored[SB_REFRESH]) return stored[SB_ACCESS] || null;

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=refresh_token`, {
    method: "POST",
    headers: authJsonHeaders,
    body: JSON.stringify({ refresh_token: stored[SB_REFRESH] })
  });
  const body = await res.json();
  if (!res.ok) {
    await clearStoredSession();
    return null;
  }
  await persistSessionFromAuthResponse(body);
  return body.access_token;
}

async function signInWithGoogle() {
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await sha256Base64Url(codeVerifier);
  const redirectTo = chrome.identity.getRedirectURL();
  const params = new URLSearchParams({
    provider: "google",
    redirect_to: redirectTo,
    code_challenge: codeChallenge,
    code_challenge_method: "S256"
  });
  const authUrl = `${SUPABASE_URL}/auth/v1/authorize?${params.toString()}`;

  const responseUrl = await new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow({ url: authUrl, interactive: true }, (url) => {
      if (chrome.runtime.lastError) reject(new Error(chrome.runtime.lastError.message));
      else resolve(url);
    });
  });

  if (!responseUrl) throw new Error("Sign-in was cancelled.");

  let parsed;
  try {
    parsed = new URL(responseUrl);
  } catch {
    throw new Error("Invalid redirect after sign-in.");
  }

  const hashParams = parsed.hash ? new URLSearchParams(parsed.hash.replace(/^#/, "")) : null;
  const err = parsed.searchParams.get("error") || hashParams?.get("error");
  if (err) {
    const desc = parsed.searchParams.get("error_description") || hashParams?.get("error_description");
    throw new Error(desc ? decodeURIComponent(desc.replace(/\+/g, " ")) : err);
  }

  const code = parsed.searchParams.get("code") || hashParams?.get("code");
  if (!code) throw new Error("No authorization code returned. Check Redirect URLs in Supabase include: " + redirectTo);

  const res = await fetch(`${SUPABASE_URL}/auth/v1/token?grant_type=pkce`, {
    method: "POST",
    headers: authJsonHeaders,
    body: JSON.stringify({ auth_code: code, code_verifier: codeVerifier })
  });
  const body = await res.json();
  if (!res.ok) {
    const msg = body.error_description || body.msg || body.message || "Could not complete sign-in.";
    throw new Error(typeof msg === "string" ? msg : JSON.stringify(msg));
  }
  await persistSessionFromAuthResponse(body);
  return { email: body.user?.email || null };
}

async function signOutSupabase() {
  const token = await chrome.storage.local.get([SB_ACCESS]).then((r) => r[SB_ACCESS]);
  if (token) {
    await fetch(`${SUPABASE_URL}/auth/v1/logout`, {
      method: "POST",
      headers: { ...authJsonHeaders, Authorization: `Bearer ${token}` }
    }).catch(() => {});
  }
  await clearStoredSession();
}

function assertNoRestError(json) {
  if (json && typeof json === "object" && !Array.isArray(json) && json.message) {
    throw new Error(json.message + (json.hint ? " — " + json.hint : ""));
  }
}

async function sbInsert(table, data) {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not signed in. Open the extension dashboard → Settings → Moodbase account → Sign in with Google.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${accessToken}`,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(data)
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.message || json.error_description || JSON.stringify(json);
    throw new Error(typeof msg === "string" ? msg : "Save failed.");
  }
  return json;
}

async function sbSelect(table, filter = "") {
  const accessToken = await getValidAccessToken();
  if (!accessToken) {
    throw new Error("Not signed in. Open the extension dashboard → Settings → Moodbase account → Sign in with Google.");
  }
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${accessToken}`
    }
  });
  const json = await res.json();
  if (!res.ok) {
    const msg = json.message || json.error_description || JSON.stringify(json);
    throw new Error(typeof msg === "string" ? msg : "Request failed.");
  }
  assertNoRestError(json);
  return json;
}

chrome.runtime.onInstalled.addListener(async () => {
  chrome.contextMenus.create({ id: "save-page", title: "Save to Moodbase", contexts: ["page"] });
  chrome.contextMenus.create({ id: "save-link", title: "Save Link to Moodbase", contexts: ["link"] });
  chrome.contextMenus.create({ id: "save-image", title: "Save Image to Moodbase", contexts: ["image"] });
  chrome.contextMenus.create({ id: "save-selection", title: "Save Selection to Moodbase", contexts: ["selection"] });
});

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  let raw = {};
  if (info.menuItemId === "save-page" || info.menuItemId === "save-link") {
    raw = { type: "link", url: info.linkUrl || tab.url, title: tab.title, favicon: tab.favIconUrl };
  } else if (info.menuItemId === "save-image") {
    raw = { type: "image", url: info.srcUrl, title: "Image from " + tab.title, favicon: tab.favIconUrl, sourceUrl: tab.url };
  } else if (info.menuItemId === "save-selection") {
    raw = { type: "note", content: info.selectionText, title: info.selectionText.substring(0, 80), sourceUrl: tab.url, favicon: tab.favIconUrl };
  }
  raw.pageContent = tab.title + " — " + (tab.url || "");
  await processAndSave(raw, tab.id);
});

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.action === "saveItem") {
    processAndSave(request.item, request.tabId)
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  }
  if (request.action === "googleSignIn") {
    signInWithGoogle()
      .then((r) => sendResponse({ success: true, ...r }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  }
  if (request.action === "signOutSupabase") {
    signOutSupabase()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  }
  if (request.action === "getAuthStatus") {
    chrome.storage.local.get([SB_ACCESS, SB_EMAIL]).then((r) => {
      sendResponse({ signedIn: !!r[SB_ACCESS], email: r[SB_EMAIL] || null });
    });
    return true;
  }
});

async function processAndSave(raw, tabId) {
  if (tabId) chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Saving…", type: "processing" }).catch(() => {});

  try {
    let projectId = null;
    let tags = [];
    let summary = "";

    const projects = await sbSelect("projects", "select=id,name,keywords");
    const aiResult = await runAI(raw, projects);
    projectId = await resolveProjectId(aiResult.project, projects);
    tags = aiResult.tags || [];
    summary = aiResult.summary || "";

    await sbInsert("items", {
      type: raw.type || "link",
      url: raw.url || null,
      title: raw.title || "Untitled",
      content: raw.content || null,
      summary,
      tags,
      favicon: raw.favicon || "",
      source_url: raw.sourceUrl || raw.url || "",
      project_id: projectId,
      visual_description: aiResult.visual_description || null,
      embedding: aiResult.embedding || null
    });

    if (tabId) {
      const projRows = projectId
        ? await sbSelect("projects", `select=name&id=eq.${projectId}`)
        : [];
      const projectName = projRows[0]?.name || "Moodbase";
      chrome.tabs.sendMessage(tabId, { action: "showToast", message: `Saved → ${projectName}`, type: "success", tags }).catch(() => {});
    }
  } catch (err) {
    console.error("Save error:", err);
    const msg = err?.message || "Could not save.";
    if (tabId) chrome.tabs.sendMessage(tabId, { action: "showToast", message: msg, type: "error" }).catch(() => {});
    throw err;
  }
}

async function resolveProjectId(slug, projects) {
  if (!slug || slug === "general") return null;
  const match = projects.find(p =>
    p.name?.toLowerCase().replace(/\s+/g, "-") === slug ||
    p.name?.toLowerCase().includes(slug.replace(/-/g, " "))
  );
  return match?.id || null;
}

async function runAI(raw, projects, apiKey) {
  const response = await fetch("https://moodbase-two-alpha.vercel.app/api/categorize", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ raw, projects })
  });
  if (!response.ok) throw new Error("Categorize API error");
  return await response.json();
}

async function getApiKey() {
  const r = await chrome.storage.local.get(["apiKey"]);
  return r.apiKey || null;
}
