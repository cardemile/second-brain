chrome.runtime.onMessage.addListener((msg) => {
  if (msg.action !== "showToast") return;

  const existing = document.getElementById("sb-toast");
  if (existing) existing.remove();

  const toast = document.createElement("div");
  toast.id = "sb-toast";
  toast.textContent = msg.message || "Saved";
  const isError = msg.type === "error";
  toast.style.cssText = `
    position: fixed;
    bottom: 24px;
    right: 24px;
    background: ${isError ? "#3a2020" : "#1A1714"};
    color: ${isError ? "#f0d0d0" : "#F8F6F2"};
    font-family: 'Instrument Sans', system-ui, sans-serif;
    font-size: 13px;
    padding: 11px 18px;
    border-radius: 10px;
    z-index: 999999;
    box-shadow: 0 4px 20px rgba(0,0,0,0.2);
    opacity: 0;
    transform: translateY(8px);
    transition: opacity 0.2s, transform 0.2s;
    pointer-events: none;
  `;

  document.body.appendChild(toast);
  requestAnimationFrame(() => {
    toast.style.opacity = "1";
    toast.style.transform = "translateY(0)";
  });

  setTimeout(() => {
    toast.style.opacity = "0";
    toast.style.transform = "translateY(8px)";
    setTimeout(() => toast.remove(), 300);
  }, isError ? 5000 : 2500);
});