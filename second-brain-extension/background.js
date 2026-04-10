// ─── Moodbase — Background Service Worker (Supabase Edition) ─────────────

const SUPABASE_URL = "https://qxgsaqvulfafqqxrkyob.supabase.co";
const SUPABASE_KEY = "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6InF4Z3NhcXZ1bGZhZnFxeHJreW9iIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzU2NDY5MzUsImV4cCI6MjA5MTIyMjkzNX0.ScmKdK5dI8xBv-35r0Zx0GwqyCVWT9MsqnIKlM7GGWg";

async function sbInsert(table, data) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "apikey": SUPABASE_KEY,
      "Authorization": `Bearer ${SUPABASE_KEY}`,
      "Prefer": "return=representation"
    },
    body: JSON.stringify(data)
  });
  return res.json();
}

async function sbSelect(table, filter = "") {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/${table}?${filter}`, {
    headers: { "apikey": SUPABASE_KEY, "Authorization": `Bearer ${SUPABASE_KEY}` }
  });
  return res.json();
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
    processAndSave(request.item, request.tabId).then(() => sendResponse({ success: true }));
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
      embedding: aiResult.embedding || null,
    });

    if (tabId) {
      const projects = await sbSelect("projects", `select=name&id=eq.${projectId}`);
      const projectName = projects[0]?.name || "Moodbase";
      chrome.tabs.sendMessage(tabId, { action: "showToast", message: `Saved → ${projectName}`, type: "success", tags }).catch(() => {});
    }
  } catch (err) {
    console.error("Save error:", err);
    await sbInsert("items", {
      type: raw.type || "link", url: raw.url || null,
      title: raw.title || "Untitled", content: raw.content || null,
      summary: "", tags: [], favicon: raw.favicon || "",
      source_url: raw.sourceUrl || raw.url || "", project_id: null
    }).catch(console.error);
    if (tabId) chrome.tabs.sendMessage(tabId, { action: "showToast", message: "Saved", type: "success" }).catch(() => {});
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
