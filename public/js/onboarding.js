(function onboardingPage() {
  const refs = {
    form: document.getElementById("onboarding-form"),
    email: document.getElementById("email"),
    customTopic: document.getElementById("custom-topic"),
    dailyCount: document.getElementById("daily-count"),
    sendTime: document.getElementById("send-time"),
    reviewTime: document.getElementById("review-time"),
    reviewEnabled: document.getElementById("review-enabled"),
    typeButtons: Array.from(document.querySelectorAll("[data-type]"))
  };

  let selectedTypes = ["spoken", "vocabulary"];

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
    syncTypeUi();
  }

  function syncTypeUi() {
    refs.typeButtons.forEach((button) => {
      const type = button.getAttribute("data-type");
      button.classList.toggle("active", selectedTypes.includes(type));
    });
  }

  function fillForm(profile) {
    if (!profile) return;
    refs.email.value = profile.email || refs.email.value;
    refs.customTopic.value = profile.customTopic || "";
    refs.dailyCount.value = String(profile.dailyCount || 3);
    refs.sendTime.value = profile.sendTime || "07:30";
    refs.reviewTime.value = profile.reviewTime || "20:30";
    refs.reviewEnabled.value = String(Boolean(profile.reviewEnabled));
    selectedTypes = Array.isArray(profile.learningTypes) && profile.learningTypes.length
      ? profile.learningTypes
      : selectedTypes;
    syncTypeUi();
  }

  async function loadExistingProfile(email) {
    if (!email) return;
    try {
      const state = await DLA.fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
      if (state?.profile) fillForm(state.profile);
      DLA.fillEmailLinks(state?.profile?.email || email);
    } catch (error) {
      DLA.showToast(error.message || "读取资料失败");
    }
  }

  async function submitForm(event) {
    event.preventDefault();
    const email = refs.email.value.trim();
    if (!email) {
      DLA.showToast("请先填写邮箱");
      refs.email.focus();
      return;
    }

    const payload = {
      email,
      customTopic: refs.customTopic.value.trim(),
      learningTypes: selectedTypes,
      dailyCount: Number(refs.dailyCount.value || 3),
      sendTime: refs.sendTime.value || "07:30",
      reviewEnabled: refs.reviewEnabled.value === "true",
      reviewTime: refs.reviewTime.value || "20:30"
    };

    try {
      await DLA.fetchJson("/api/profile", { method: "POST", body: payload });
      DLA.rememberEmail(email);
      window.location.href = `/today?email=${encodeURIComponent(email)}`;
    } catch (error) {
      DLA.showToast(error.message || "保存失败");
    }
  }

  function bind() {
    refs.typeButtons.forEach((button) => {
      button.addEventListener("click", () => toggleType(button.getAttribute("data-type")));
    });
    refs.form.addEventListener("submit", submitForm);
  }

  function init() {
    bind();
    syncTypeUi();
    const email = DLA.getParam("email") || DLA.getEmailFromUrlOrStorage();
    if (email) {
      refs.email.value = email;
      loadExistingProfile(email);
    }
  }

  init();
})();
