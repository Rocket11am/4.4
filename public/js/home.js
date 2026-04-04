(function homePage() {
  var refs = {
    heroEmail: document.getElementById("hero-email"),
    heroStreak: document.getElementById("hero-streak"),
    heroRate: document.getElementById("hero-rate"),
    heroNext: document.getElementById("hero-next"),
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
      refs.heroStreak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0)) + " 天";
      refs.heroRate.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
      refs.heroNext.textContent = DLA.safeGet(state, ["profile", "sendTime"], "--:--");
    } catch (error) {
      DLA.showToast(error.message || "获取状态失败");
    }
  }

  init();
})();
