// ─── Moodbase — Background Service Worker (Supabase Edition) ─────────────
// RLS requires a logged-in JWT on REST calls. The session is copied from
// https://moodbase.vercel.app (same Supabase localStorage as the web app).

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

function sessionExpiresAtSeconds(body) {
  if (body.expires_at != null) return body.expires_at;
  return Math.floor(Date.now() / 1000) + (body.expires_in || 3600);
}

async function persistSessionFromAuthResponse(body) {
  if (!body?.access_token) {
    await clearStoredSession();
    return;
  }
  const prev = await chrome.storage.local.get([SB_REFRESH]);
  await chrome.storage.local.set({
    [SB_ACCESS]: body.access_token,
    [SB_REFRESH]: body.refresh_token || prev[SB_REFRESH] || null,
    [SB_EXPIRES]: sessionExpiresAtSeconds(body),
    [SB_EMAIL]: body.user?.email ?? null
  });
}

/** Parsed row from Supabase JS localStorage (`sb-…-auth-token`) or token API body. */
async function persistSessionFromSupabaseSession(session) {
  if (!session?.access_token) {
    await clearStoredSession();
    return;
  }
  await persistSessionFromAuthResponse(session);
}

async function refreshSessionFromWebTabs() {
  try {
    const tabs = await chrome.tabs.query({ url: "https://moodbase.vercel.app/*" });
    for (const tab of tabs) {
      try {
        const session = await chrome.tabs.sendMessage(tab.id, { action: "readSupabaseSession" });
        if (session?.access_token) {
          await persistSessionFromSupabaseSession(session);
          return true;
        }
      } catch {
        /* tab has no bridge yet */
      }
    }
  } catch {
    /* ignore */
  }
  return false;
}

async function clearStoredSession() {
  await chrome.storage.local.remove([SB_ACCESS, SB_REFRESH, SB_EXPIRES, SB_EMAIL]);
}

function accessTokenIsFresh(stored, nowSec) {
  return !!(stored[SB_ACCESS] && stored[SB_EXPIRES] && stored[SB_EXPIRES] > nowSec + 90);
}

async function getValidAccessToken() {
  let stored = await chrome.storage.local.get([SB_ACCESS, SB_REFRESH, SB_EXPIRES]);
  const now = Date.now() / 1000;

  if (!accessTokenIsFresh(stored, now) && !stored[SB_REFRESH]) {
    await refreshSessionFromWebTabs();
    stored = await chrome.storage.local.get([SB_ACCESS, SB_REFRESH, SB_EXPIRES]);
  }

  if (accessTokenIsFresh(stored, now)) return stored[SB_ACCESS];

  if (!stored[SB_REFRESH]) {
    await refreshSessionFromWebTabs();
    stored = await chrome.storage.local.get([SB_ACCESS, SB_REFRESH, SB_EXPIRES]);
    if (accessTokenIsFresh(stored, now)) return stored[SB_ACCESS];
    if (!stored[SB_REFRESH]) return stored[SB_ACCESS] || null;
  }

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

/** Clears only the extension copy; the web app session at moodbase.vercel.app is unchanged. */
async function signOutSupabase() {
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
    throw new Error(
      "Not signed in. Log in at https://moodbase.vercel.app (keep that tab open or use Settings → Sync session)."
    );
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
    throw new Error(
      "Not signed in. Log in at https://moodbase.vercel.app (keep that tab open or use Settings → Sync session)."
    );
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
  if (request.action === "syncSessionFromWebApp") {
    console.log("[Moodbase background] syncSessionFromWebApp received", {
      tabId: sender?.tab?.id ?? null,
      frameId: sender?.frameId ?? null,
      url: sender?.url ?? null,
      hasSession: !!request.session,
      hasAccessToken: !!request.session?.access_token,
      userEmail: request.session?.user?.email ?? null
    });
    persistSessionFromSupabaseSession(request.session)
      .then(() => {
        console.log("[Moodbase background] syncSessionFromWebApp persist finished OK");
        sendResponse({ success: true });
      })
      .catch((e) => {
        console.warn("[Moodbase background] syncSessionFromWebApp persist failed", e?.message || e);
        sendResponse({ success: false, error: e?.message || String(e) });
      });
    return true;
  }
  if (request.action === "syncSessionFromWeb") {
    refreshSessionFromWebTabs()
      .then(async (synced) => {
        const r = await chrome.storage.local.get([SB_ACCESS, SB_EMAIL]);
        sendResponse({
          success: !!r[SB_ACCESS],
          synced,
          email: r[SB_EMAIL] || null,
          error: r[SB_ACCESS]
            ? null
            : "Open https://moodbase.vercel.app while logged in, then try Sync again."
        });
      })
      .catch((e) => sendResponse({ success: false, synced: false, error: e?.message || String(e) }));
    return true;
  }
  if (request.action === "signOutSupabase") {
    signOutSupabase()
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
    return true;
  }
  if (request.action === "getAuthStatus") {
    (async () => {
      let r = await chrome.storage.local.get([SB_ACCESS, SB_EMAIL]);
      if (!r[SB_ACCESS]) await refreshSessionFromWebTabs();
      r = await chrome.storage.local.get([SB_ACCESS, SB_EMAIL]);
      sendResponse({ signedIn: !!r[SB_ACCESS], email: r[SB_EMAIL] || null });
    })();
    return true;
  }
  if (request.action === "getState") {
    chrome.storage.local.get(["items", "projects"]).then((r) => {
      sendResponse({ items: r.items || [], projects: r.projects || [] });
    });
    return true;
  }
  if (request.action === "updateProjects") {
    chrome.storage.local
      .set({ projects: request.projects || [] })
      .then(() => sendResponse({ success: true }))
      .catch((e) => sendResponse({ success: false, error: e?.message || String(e) }));
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
