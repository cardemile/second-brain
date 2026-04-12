const PROJECT_COLORS = {
  "bali-water": "#4a9eba",
  "modern-women": "#c47fb0",
  "bali-prime": "#7ab87a",
  "brand-identity": "#c9a96e",
  "content-strategy": "#9b8bc4",
  general: "#4a4540"
};

let currentTab = null;
let projects = [];

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  currentTab = tab;

  document.getElementById("pageTitle").textContent = tab.title || tab.url;
  const fav = document.getElementById("pageFavicon");
  if (tab.favIconUrl) {
    fav.src = tab.favIconUrl;
    fav.onerror = () => {
      fav.style.display = "none";
    };
  }

  const state = await new Promise((res) => chrome.runtime.sendMessage({ action: "getState" }, res));
  projects = state.projects || [];

  const apiKey = await new Promise((res) => chrome.storage.local.get(["apiKey"], (r) => res(r.apiKey)));
  if (!apiKey) {
    document.getElementById("apiKeyNotice").style.display = "block";
    document.getElementById("projectHint").textContent = "No API key — will save without AI sorting";
  }

  renderRecent(state.items || []);
}

function renderRecent(items) {
  const container = document.getElementById("recentList");
  const recent = items.slice(0, 4);

  if (!recent.length) {
    container.innerHTML = `<div style="color:var(--text-muted);font-size:10px;font-style:italic;">Nothing saved yet</div>`;
    return;
  }

  container.innerHTML = recent
    .map((item) => {
      const proj = projects.find((p) => p.id === item.project);
      const color = proj?.color || PROJECT_COLORS[item.project] || "#4a4540";
      const processing = item.processing;

      return `
      <div class="recent-item">
        ${
          processing
            ? `<span class="processing-pulse"></span>`
            : `<div class="recent-dot" style="background:${color}"></div>`
        }
        <div class="recent-title">${item.title || "Untitled"}</div>
        <div class="recent-project">${processing ? "processing…" : proj?.name || item.project || ""}</div>
      </div>
    `;
    })
    .join("");
}

document.getElementById("saveBtn").onclick = async () => {
  const btn = document.getElementById("saveBtn");
  btn.disabled = true;
  btn.innerHTML = `<span class="processing-pulse"></span><span>saving…</span>`;

  const note = document.getElementById("noteInput").value.trim();

  const item = {
    type: "link",
    url: currentTab.url,
    title: currentTab.title,
    favicon: currentTab.favIconUrl || "",
    sourceUrl: currentTab.url,
    pageContent: currentTab.title + " — " + currentTab.url,
    note
  };

  const saveRes = await new Promise((res) =>
    chrome.runtime.sendMessage({ action: "saveItem", item, tabId: currentTab.id }, res)
  );

  if (!saveRes?.success) {
    document.getElementById("projectHint").textContent =
      saveRes?.error || "Save failed. Log in at moodbase.vercel.app and sync session in the dashboard (Settings).";
    btn.disabled = false;
    btn.innerHTML = `<span>save to Moodbase</span>`;
    return;
  }

  document.getElementById("noteInput").value = "";
  document.getElementById("projectHint").textContent = "Saved! AI is sorting… ✦";

  setTimeout(async () => {
    const state = await new Promise((res) => chrome.runtime.sendMessage({ action: "getState" }, res));
    renderRecent(state.items || []);
    btn.disabled = false;
    btn.innerHTML = `<span>save to Moodbase</span>`;
    document.getElementById("projectHint").textContent = "AI will sort this automatically ✦";
  }, 800);
};

document.getElementById("openDashboard").onclick = () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
};

document.getElementById("goToDashboard")?.addEventListener("click", () => {
  chrome.tabs.create({ url: chrome.runtime.getURL("dashboard.html") });
});

chrome.storage.onChanged.addListener((changes) => {
  if (changes.items) renderRecent(changes.items.newValue || []);
});

init();
