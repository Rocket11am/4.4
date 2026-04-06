(function initDlaCommon() {
  var STORAGE_KEY = "daily-learning-assistant:last-email";
  var STATE_PREFIX = "daily-learning-assistant:state:";

  function getParam(name) {
    try {
      return new URLSearchParams(window.location.search).get(name) || "";
    } catch (e) {
      return "";
    }
  }

  function normalizeEmail(value) {
    return String(value || "").trim();
  }

  function getStateStorageKey(email) {
    var clean = normalizeEmail(email).toLowerCase();
    return STATE_PREFIX + clean;
  }

  function rememberEmail(email) {
    var clean = normalizeEmail(email);
    if (!clean) return;
    try {
      window.localStorage.setItem(STORAGE_KEY, clean);
    } catch (e) {}
  }

  function loadRememberedEmail() {
    try {
      return window.localStorage.getItem(STORAGE_KEY) || "";
    } catch (e) {
      return "";
    }
  }

  function getEmailFromUrlOrStorage() {
    return normalizeEmail(getParam("email") || loadRememberedEmail());
  }

  function cacheState(email, state) {
    var clean = normalizeEmail(email || (state && state.profile && state.profile.email));
    if (!clean || !state) return;
    try {
      window.localStorage.setItem(getStateStorageKey(clean), JSON.stringify(state));
    } catch (e) {}
  }

  function loadCachedState(email) {
    var clean = normalizeEmail(email);
    if (!clean) return null;
    try {
      var raw = window.localStorage.getItem(getStateStorageKey(clean));
      return raw ? JSON.parse(raw) : null;
    } catch (e) {
      return null;
    }
  }

  function safeGet(obj, path, fallback) {
    var target = obj;
    var i;
    for (i = 0; i < path.length; i += 1) {
      if (!target || typeof target !== "object" || !(path[i] in target)) return fallback;
      target = target[path[i]];
    }
    return target === undefined || target === null ? fallback : target;
  }

  async function fetchJson(url, options) {
    var config = options ? Object.assign({}, options) : {};
    if (config.body && typeof config.body !== "string") {
      config.body = JSON.stringify(config.body);
    }
    config.headers = Object.assign({}, config.headers || {}, config.body ? { "Content-Type": "application/json" } : {});

    var response = await fetch(url, config);
    var data;
    try {
      data = await response.json();
    } catch (e) {
      data = {};
    }

    if (!response.ok || data.ok === false) {
      throw new Error(data.message || ("请求失败：" + response.status));
    }
    return data;
  }

  async function restoreState(email, cachedState) {
    var clean = normalizeEmail(email);
    if (!clean || !cachedState) return null;
    try {
      var restored = await fetchJson("/api/restore-state", {
        method: "POST",
        body: {
          email: clean,
          profile: cachedState.profile || null,
          history: Array.isArray(cachedState.history) ? cachedState.history : [],
          pet: cachedState.pet || null
        }
      });
      if (restored && restored.profile) {
        cacheState(clean, restored);
        return restored;
      }
    } catch (e) {}
    return null;
  }

  function labelForType(type) {
    return {
      spoken: "地道口语表达",
      vocabulary: "单词记忆",
      finance: "每日财经资讯",
      ai_news: "每日AI前沿资讯",
      custom: "自定义主题"
    }[type] || "综合学习";
  }

  function formatDateTime(value) {
    if (!value) return "--";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleString("zh-CN");
  }

  function formatDate(value) {
    if (!value) return "--";
    var date = new Date(value);
    if (Number.isNaN(date.getTime())) return "--";
    return date.toLocaleDateString("zh-CN");
  }

  function escapeHtml(value) {
    return String(value === undefined || value === null ? "" : value)
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;");
  }

  function showToast(message) {
    var toast = document.getElementById("global-toast");
    if (!toast) {
      toast = document.createElement("div");
      toast.id = "global-toast";
      toast.className = "toast";
      document.body.appendChild(toast);
    }
    toast.textContent = message;
    toast.classList.add("show");
    clearTimeout(showToast.timer);
    showToast.timer = setTimeout(function () {
      toast.classList.remove("show");
    }, 2600);
  }

  function fillEmailLinks(email) {
    var clean = normalizeEmail(email);
    var nodes = document.querySelectorAll("[data-email-link]");
    nodes.forEach(function (node) {
      var path = node.getAttribute("data-email-link");
      if (!path) return;
      if (!clean) {
        node.setAttribute("href", path);
        return;
      }
      var sep = path.indexOf("?") >= 0 ? "&" : "?";
      node.setAttribute("href", path + sep + "email=" + encodeURIComponent(clean));
    });
  }

  function markActiveNav() {
    var currentPath = window.location.pathname || "/";
    if (currentPath.length > 1 && currentPath.charAt(currentPath.length - 1) === "/") {
      currentPath = currentPath.slice(0, -1);
    }

    document.querySelectorAll(".nav-link").forEach(function (node) {
      var href = node.getAttribute("href") || "";
      var linkPath = href.split("?")[0] || "";
      if (!linkPath) return;
      if (linkPath.length > 1 && linkPath.charAt(linkPath.length - 1) === "/") {
        linkPath = linkPath.slice(0, -1);
      }
      node.classList.toggle("is-active", linkPath === currentPath);
    });
  }

  markActiveNav();

  window.DLA = {
    getParam: getParam,
    getEmailFromUrlOrStorage: getEmailFromUrlOrStorage,
    rememberEmail: rememberEmail,
    cacheState: cacheState,
    loadCachedState: loadCachedState,
    fetchJson: fetchJson,
    restoreState: restoreState,
    labelForType: labelForType,
    formatDateTime: formatDateTime,
    formatDate: formatDate,
    escapeHtml: escapeHtml,
    showToast: showToast,
    fillEmailLinks: fillEmailLinks,
    safeGet: safeGet,
    markActiveNav: markActiveNav
  };
})();
