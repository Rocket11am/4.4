(function homePage() {
  var refs = {
    heroEmail: document.getElementById("hero-email"),
    heroStreak: document.getElementById("hero-streak"),
    heroRate: document.getElementById("hero-rate"),
    heroNext: document.getElementById("hero-next"),
    heroEvening: document.getElementById("hero-evening"),
    startNow: document.getElementById("start-now")
  };

  async function init() {
    var email = DLA.getEmailFromUrlOrStorage();
    DLA.fillEmailLinks(email);
    if (!email) return;

    refs.heroEmail.textContent = email;
    refs.startNow.href = "/settings?email=" + encodeURIComponent(email);

    try {
      var state = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
      if (state && state.profile) DLA.cacheState(email, state);
      refs.heroStreak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0)) + " 天";
      refs.heroRate.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
      refs.heroNext.textContent = DLA.safeGet(state, ["profile", "sendTime"], "--:--");
      refs.heroEvening.textContent = DLA.safeGet(state, ["profile", "reviewTime"], "--:--");
    } catch (error) {
      var cachedState = DLA.loadCachedState(email);
      if (cachedState && cachedState.profile) {
        refs.heroStreak.textContent = String(DLA.safeGet(cachedState, ["stats", "streak"], 0)) + " 天";
        refs.heroRate.textContent = String(DLA.safeGet(cachedState, ["stats", "completionRate"], 0)) + "%";
        refs.heroNext.textContent = DLA.safeGet(cachedState, ["profile", "sendTime"], "--:--");
        refs.heroEvening.textContent = DLA.safeGet(cachedState, ["profile", "reviewTime"], "--:--");
        return;
      }
      DLA.showToast(error.message || "获取状态失败");
    }
  }

  init();
})();
