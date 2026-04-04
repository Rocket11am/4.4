(function initDlaCommon() {
  const STORAGE_KEY = "daily-learning-assistant:last-email";

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || "";
    } catch {
      return "";
    }
  }

  function normalizeEmail(value) {
    return String(value || "").trim();
  }

  function rememberEmail(email) {
    const clean = normalizeEmail(email);
    if (!clean) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, clean);
    } catch {}
  }

  function loadRememberedEmail() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch {
      return "";
    }
  }

  function getEmailFromUrlOrStorage() {
    return normalizeEmail(getParam("email") || loadRememberedEmail());
  }

  async function fetchJson(url, options = {}) {
    const config = { ...options };
    if (config.body && typeof config.body !== "string") {
      config.body = JSON.stringify(config.body);
    }
    config.headers = {
      ...(config.headers || {}),
      ...(config.body ? { "Content-Type": "application/json" } : {})
    };

    const response = await fetch(url, config);
    const data = await response.json().catch(() => ({}));
    if (!response.ok || data.ok === false) {
      const message = data.message || `请求失败（${response.status}）`;
      throw new Error(message);
    }
    return data;
  }

  function labelForType(type) {
    return {
      spoken: "英语口语",
      vocabulary: "英语单词",
      finance: "财经新闻",
      custom: "自定义主题"
    }[type] || "综合学习";
  }

  function formatDateTime(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN");
  }

  function formatDate(value) {
    if (!value) return "--";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("zh-CN");
  }

  function escapeHtml(value) {
    return String(value ?? "")
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }

  function showToast(message) {
    let toast = document.getElementById("global-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "global-toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(() => toast.classList.remove("show"), 2600);
  }

  function fillEmailLinks(email) {
    const clean = normalizeEmail(email);
    document.querySelectorAll("[data-email-link]").forEach((node) => {
      const path = node.getAttribute("data-email-link");
      if (!path) return;
      if (!clean) {
        node.setAttribute("href", path);
        return;
      }
      const sep = path.includes("?") ? "&" : "?";
      node.setAttribute("href", `${path}${sep}email=${encodeURIComponent(clean)}`);
    });
  }

  window.DLA = {
    getParam,
    getEmailFromUrlOrStorage,
    rememberEmail,
    fetchJson,
    labelForType,
    formatDateTime,
    formatDate,
    escapeHtml,
    showToast,
    fillEmailLinks
  };
})();
