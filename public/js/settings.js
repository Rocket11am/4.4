(function settingsPage() {
  var refs = {
    settingsEmpty: document.getElementById("settings-empty"),
    settingsContent: document.getElementById("settings-content"),
    form: document.getElementById("settings-form"),
    email: document.getElementById("email"),
    petName: document.getElementById("pet-name"),
    dailyCount: document.getElementById("daily-count"),
    sendTime: document.getElementById("send-time"),
    reviewTime: document.getElementById("review-time"),
    reviewEnabled: document.getElementById("review-enabled"),
    backupChannel: document.getElementById("backup-channel"),
    backupContact: document.getElementById("backup-contact"),
    typeButtons: Array.from(document.querySelectorAll("[data-type]"))
  };

  var selectedTypes = ["spoken", "vocabulary"];
  function normalizeDailyCount(value) {
    var count = Number(value || 5);
    if (Number.isNaN(count)) return 5;
    return Math.max(1, Math.min(6, count));
  }

  function syncTypes() {
    refs.typeButtons.forEach(function (button) {
      var type = button.getAttribute("data-type");
      button.classList.toggle("active", selectedTypes.indexOf(type) >= 0);
    });
  }

  function toggleType(type) {
    if (selectedTypes.indexOf(type) >= 0) {
      if (selectedTypes.length === 1) {
        DLA.showToast("至少保留一个学习类型");
        return;
      }
      selectedTypes = selectedTypes.filter(function (item) { return item !== type; });
    } else {
      selectedTypes.push(type);
    }
    syncTypes();
  }

  function showContent() {
    if (refs.settingsEmpty) refs.settingsEmpty.hidden = true;
    if (refs.settingsContent) refs.settingsContent.hidden = false;
  }

  function fillForm(profile) {
    refs.email.value = profile.email || "";
    refs.petName.value = profile.petName || "";
    refs.dailyCount.value = String(normalizeDailyCount(profile.dailyCount));
    refs.sendTime.value = profile.sendTime || "07:30";
    refs.reviewEnabled.value = String(Boolean(profile.reviewEnabled));
    refs.reviewTime.value = profile.reviewTime || "20:30";
    refs.backupChannel.value = profile.backupChannel || "wechat";
    refs.backupContact.value = profile.backupContact || "";
    if (Array.isArray(profile.learningTypes) && profile.learningTypes.length) {
      selectedTypes = profile.learningTypes.slice();
    }
    syncTypes();
  }

  async function submit(event) {
    event.preventDefault();
    var email = refs.email.value.trim();
    if (!email) {
      DLA.showToast("请先填写邮箱");
      refs.email.focus();
      return;
    }

    var payload = {
      email: email,
      petName: refs.petName.value.trim(),
      customTopic: "",
      learningTypes: selectedTypes.slice(),
      dailyCount: normalizeDailyCount(refs.dailyCount.value),
      sendTime: refs.sendTime.value || "07:30",
      reviewEnabled: refs.reviewEnabled.value === "true",
      reviewTime: refs.reviewTime.value || "20:30",
      backupChannel: refs.backupChannel.value,
      backupContact: refs.backupContact.value.trim()
    };

    try {
      var response = await DLA.fetchJson("/api/profile", { method: "POST", body: payload });
      DLA.rememberEmail(email);
      if (response && response.profile) DLA.cacheState(email, response);
      window.location.href = "/today?email=" + encodeURIComponent(email);
    } catch (error) {
      DLA.showToast(error.message || "保存失败");
    }
  }

  async function init() {
    refs.typeButtons.forEach(function (button) {
      button.addEventListener("click", function () {
        toggleType(button.getAttribute("data-type"));
      });
    });
    refs.form.addEventListener("submit", submit);
    syncTypes();
    showContent();

    var email = DLA.getEmailFromUrlOrStorage();
    if (!email) return;
    DLA.rememberEmail(email);

    try {
      var remote = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
      if (remote && remote.profile) {
        DLA.cacheState(email, remote);
        fillForm(remote.profile);
        DLA.fillEmailLinks(remote.profile.email);
        return;
      }

      var cached = DLA.loadCachedState(email);
      if (cached && cached.profile) {
        var restored = await DLA.restoreState(email, cached);
        var finalState = restored && restored.profile ? restored : cached;
        DLA.cacheState(email, finalState);
        fillForm(finalState.profile);
        DLA.fillEmailLinks(finalState.profile.email);
      }
    } catch (error) {
      var backup = DLA.loadCachedState(email);
      if (backup && backup.profile) {
        fillForm(backup.profile);
        DLA.fillEmailLinks(backup.profile.email);
        DLA.showToast("当前使用本地缓存设置，已尝试自动恢复。");
        return;
      }
      DLA.showToast(error.message || "加载失败，可直接手动填写设置");
    }
  }

  init();
})();
