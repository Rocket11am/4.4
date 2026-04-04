(function historyPage() {
  const refs = {
    historyEmpty: document.getElementById("history-empty"),
    historyContent: document.getElementById("history-content"),
    statStreak: document.getElementById("stat-streak"),
    statDays: document.getElementById("stat-days"),
    statCompletion: document.getElementById("stat-completion"),
    statAccuracy: document.getElementById("stat-accuracy"),
    timeline: document.getElementById("timeline"),
    sessionList: document.getElementById("session-list"),
    sessionDetail: document.getElementById("session-detail")
  };

  let email = "";
  let state = null;
  let selectedId = "";

  function renderTimeline() {
    const timeline = state?.timeline || [];
    if (!timeline.length) {
      refs.timeline.innerHTML = '<div class="empty">暂无趋势数据。</div>';
      return;
    }

    refs.timeline.innerHTML = timeline.map((item) => {
      const height = Math.max(10, Math.min(70, item.sent * 16 + (item.completed ? 18 : 0) + Math.round((item.accuracy || 0) / 8)));
      return `
        <div class="timeline-col">
          <div class="timeline-bar-wrap"><div class="timeline-bar" style="height:${height}px"></div></div>
          <div class="tiny">${DLA.escapeHtml(item.label)}</div>
          <div class="tiny">${item.completed ? "已完成" : "未完成"} · ${item.accuracy || 0}%</div>
        </div>
      `;
    }).join("");
  }

  function renderList() {
    const list = state?.history || [];
    if (!list.length) {
      refs.sessionList.innerHTML = '<div class="empty">暂无历史记录。</div>';
      refs.sessionDetail.innerHTML = '<div class="empty">暂无详情。</div>';
      return;
    }

    if (!selectedId) selectedId = list[0].id;
    refs.sessionList.innerHTML = list.map((session) => `
      <button class="session-item ${selectedId === session.id ? "active" : ""}" data-id="${session.id}" type="button">
        <strong>${DLA.escapeHtml(session.date)}</strong>
        <div class="tiny">${DLA.escapeHtml((session.learningTypes || []).map(DLA.labelForType).join(" / "))}</div>
        <div class="tiny">${session.completedAt ? "已完成" : "未完成"} · ${session.quizResult ? `${session.quizResult.accuracy}%` : "未测验"}</div>
      </button>
    `).join("");

    Array.from(refs.sessionList.querySelectorAll("[data-id]")).forEach((button) => {
      button.addEventListener("click", () => {
        selectedId = button.getAttribute("data-id") || "";
        renderList();
      });
    });

    const target = list.find((item) => item.id === selectedId) || list[0];
    const morning = target?.delivery?.morning;
    const evening = target?.delivery?.evening;
    refs.sessionDetail.innerHTML = `
      <article class="list-item">
        <strong>${DLA.escapeHtml(target?.date || "--")}</strong>
        <p class="muted">学习类型：${DLA.escapeHtml((target?.learningTypes || []).map(DLA.labelForType).join(" / ") || "--")}</p>
        <p class="muted">完成时间：${DLA.escapeHtml(DLA.formatDateTime(target?.completedAt))}</p>
        <p class="muted">晨间邮件：${morning ? `打开 ${morning.opens || 0} / 点击 ${morning.clicks || 0}` : "未发送"}</p>
        <p class="muted">晚间邮件：${evening ? `打开 ${evening.opens || 0} / 点击 ${evening.clicks || 0}` : "未发送"}</p>
        <p class="muted">测验结果：${target?.quizResult ? `${target.quizResult.score}/${target.quizResult.total}（${target.quizResult.accuracy}%）` : "未提交"}</p>
      </article>
    `;
  }

  function render() {
    refs.historyEmpty.hidden = true;
    refs.historyContent.hidden = false;
    DLA.fillEmailLinks(email);

    refs.statStreak.textContent = String(state?.stats?.streak || 0);
    refs.statDays.textContent = String(state?.stats?.activeDays || 0);
    refs.statCompletion.textContent = `${state?.stats?.completionRate || 0}%`;
    refs.statAccuracy.textContent = `${state?.stats?.accuracy || 0}%`;

    renderTimeline();
    renderList();
  }

  function showEmpty() {
    refs.historyEmpty.hidden = false;
    refs.historyContent.hidden = true;
  }

  async function init() {
    email = DLA.getEmailFromUrlOrStorage();
    if (!email) {
      showEmpty();
      return;
    }
    DLA.rememberEmail(email);
    try {
      state = await DLA.fetchJson(`/api/state?email=${encodeURIComponent(email)}`);
      if (!state?.profile) {
        showEmpty();
        return;
      }
      render();
    } catch (error) {
      DLA.showToast(error.message || "加载失败");
      showEmpty();
    }
  }

  init();
})();
