(function homePage() {
  const refs = {
    heroEmail: document.getElementById("hero-email"),
    heroStreak: document.getElementById("hero-streak"),
    heroRate: document.getElementById("hero-rate"),
    heroNext: document.getElementById("hero-next"),
    startNow: document.getElementById("start-now")
  };

  async function init() {
    const email = DLA.getEmailFromUrlOrStorage();
    DLA.fillEmailLinks(email);

    if (!email) return;
    refs.heroEmail.textContent = email;
    refs.startNow.href = `/onboarding?email=${encodeURIComponent(email)}`;

    try {
      const state = await DLA.fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
      refs.heroStreak.textContent = `${state?.stats?.streak || 0} 天`;
      refs.heroRate.textContent = `${state?.stats?.completionRate || 0}%`;
      refs.heroNext.textContent = state?.profile?.sendTime || "--:--";
    } catch (error) {
      DLA.showToast(error.message || "获取状态失败");
    }
  }

  init();
})();
