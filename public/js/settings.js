(function settingsPage() {
  const refs = {
    settingsEmpty: document.getElementById("settings-empty"),
    settingsContent: document.getElementById("settings-content"),
    form: document.getElementById("settings-form"),
    email: document.getElementById("email"),
    customTopic: document.getElementById("custom-topic"),
    dailyCount: document.getElementById("daily-count"),
    sendTime: document.getElementById("send-time"),
    reviewTime: document.getElementById("review-time"),
    reviewEnabled: document.getElementById("review-enabled"),
    backupChannel: document.getElementById("backup-channel"),
    backupContact: document.getElementById("backup-contact"),
    typeButtons: Array.from(document.querySelectorAll("[data-type]"))
  };

  let selectedTypes = ["spoken", "vocabulary"];

  function syncTypes() {
    refs.typeButtons.forEach((button) => {
      const type = button.getAttribute("data-type");
      button.classList.toggle("active", selectedTypes.includes(type));
    });
  }

  function toggleType(type) {
    if (selectedTypes.includes(type)) {
      if (selectedTypes.length === 1) {
        DLA.showToast("至少保留一个学习类型");
        return;
      }
      selectedTypes = selectedTypes.filter((item) => item !== type);
    } else {
      selectedTypes = [...selectedTypes, type];
    }
    syncTypes();
  }

  function showEmpty() {
    refs.settingsEmpty.hidden = false;
    refs.settingsContent.hidden = true;
  }

  function showContent() {
    refs.settingsEmpty.hidden = true;
    refs.settingsContent.hidden = false;
  }

  function fillForm(profile) {
    refs.email.value = profile.email || "";
    refs.customTopic.value = profile.customTopic || "";
    refs.dailyCount.value = String(profile.dailyCount || 3);
    refs.sendTime.value = profile.sendTime || "07:30";
    refs.reviewEnabled.value = String(Boolean(profile.reviewEnabled));
    refs.reviewTime.value = profile.reviewTime || "20:30";
    refs.backupChannel.value = profile.backupChannel || "wechat";
    refs.backupContact.value = profile.backupContact || "";
    selectedTypes = Array.isArray(profile.learningTypes) && profile.learningTypes.length
      ? profile.learningTypes
      : selectedTypes;
    syncTypes();
  }

  async function submit(event) {
    event.preventDefault();
    const email = refs.email.value.trim();
    if (!email) {
      DLA.showToast("请先填写邮箱");
      return;
    }

    const payload = {
      email,
      customTopic: refs.customTopic.value.trim(),
      learningTypes: selectedTypes,
      dailyCount: Number(refs.dailyCount.value || 3),
      sendTime: refs.sendTime.value || "07:30",
      reviewEnabled: refs.reviewEnabled.value === "true",
      reviewTime: refs.reviewTime.value || "20:30",
      backupChannel: refs.backupChannel.value,
      backupContact: refs.backupContact.value.trim()
    };

    try {
      await DLA.fetchJson("/api/profile", { method: "POST", body: payload });
      DLA.rememberEmail(email);
      window.location.href = `/today?email=${encodeURIComponent(email)}`;
    } catch (error) {
      DLA.showToast(error.message || "保存失败");
    }
  }

  async function init() {
    refs.typeButtons.forEach((button) => {
      button.addEventListener("click", () => toggleType(button.getAttribute("data-type")));
    });
    refs.form.addEventListener("submit", submit);
    syncTypes();

    const email = DLA.getEmailFromUrlOrStorage();
    if (!email) {
      showEmpty();
      return;
    }
    DLA.rememberEmail(email);

    try {
      const state = await DLA.fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
      if (!state?.profile) {
        showEmpty();
        return;
      }
      fillForm(state.profile);
      DLA.fillEmailLinks(state.profile.email);
      showContent();
    } catch (error) {
      DLA.showToast(error.message || "加载失败");
      showEmpty();
    }
  }

  init();
})();
