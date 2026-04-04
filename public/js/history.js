(function historyPage() {
  var refs = {
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

  var email = "";
  var state = null;
  var selectedId = "";

  function renderTimeline() {
    var timeline = state && Array.isArray(state.timeline) ? state.timeline : [];
    if (!timeline.length) {
      refs.timeline.innerHTML = '<div class="empty">暂无趋势数据。</div>';
      return;
    }

    refs.timeline.innerHTML = timeline.map(function (item) {
      var height = Math.max(10, Math.min(70, (item.sent || 0) * 16 + (item.completed ? 18 : 0) + Math.round((item.accuracy || 0) / 8)));
      return [
        '<div class="timeline-col">',
        '<div class="timeline-bar-wrap"><div class="timeline-bar" style="height:' + height + 'px"></div></div>',
        '<div class="tiny">' + DLA.escapeHtml(item.label) + "</div>",
        '<div class="tiny">' + (item.completed ? "已完成" : "未完成") + " · " + (item.accuracy || 0) + "%</div>",
        "</div>"
      ].join("");
    }).join("");
  }

  function renderList() {
    var list = state && Array.isArray(state.history) ? state.history : [];
    if (!list.length) {
      refs.sessionList.innerHTML = '<div class="empty">暂无历史记录。</div>';
      refs.sessionDetail.innerHTML = '<div class="empty">暂无详情。</div>';
      return;
    }

    if (!selectedId) selectedId = list[0].id;
    refs.sessionList.innerHTML = list.map(function (session) {
      var types = (session.learningTypes || []).map(DLA.labelForType).join(" / ");
      var reviewLabel = session.quizResult ? (session.quizResult.accuracy + "%") : "未测验";
      return [
        '<button class="session-item ' + (selectedId === session.id ? "active" : "") + '" data-id="' + session.id + '" type="button">',
        "<strong>" + DLA.escapeHtml(session.date) + "</strong>",
        '<div class="tiny">' + DLA.escapeHtml(types) + "</div>",
        '<div class="tiny">' + (session.completedAt ? "已完成" : "未完成") + " · " + reviewLabel + "</div>",
        "</button>"
      ].join("");
    }).join("");

    Array.from(refs.sessionList.querySelectorAll("[data-id]")).forEach(function (button) {
      button.addEventListener("click", function () {
        selectedId = button.getAttribute("data-id") || "";
        renderList();
      });
    });

    var target = list.filter(function (item) { return item.id === selectedId; })[0] || list[0];
    var morning = target && target.delivery ? target.delivery.morning : null;
    var evening = target && target.delivery ? target.delivery.evening : null;
    var typesText = (target.learningTypes || []).map(DLA.labelForType).join(" / ");
    var quizText = target.quizResult
      ? (target.quizResult.score + "/" + target.quizResult.total + "（" + target.quizResult.accuracy + "%）")
      : "未提交";

    refs.sessionDetail.innerHTML = [
      '<article class="list-item">',
      "<strong>" + DLA.escapeHtml(target.date || "--") + "</strong>",
      '<p class="muted">学习类型：' + DLA.escapeHtml(typesText || "--") + "</p>",
      '<p class="muted">完成时间：' + DLA.escapeHtml(DLA.formatDateTime(target.completedAt)) + "</p>",
      '<p class="muted">晨间邮件：' + (morning ? ("打开 " + (morning.opens || 0) + " / 点击 " + (morning.clicks || 0)) : "未发送") + "</p>",
      '<p class="muted">晚间邮件：' + (evening ? ("打开 " + (evening.opens || 0) + " / 点击 " + (evening.clicks || 0)) : "未发送") + "</p>",
      '<p class="muted">测验结果：' + quizText + "</p>",
      "</article>"
    ].join("");
  }

  function render() {
    refs.historyEmpty.hidden = true;
    refs.historyContent.hidden = false;
    DLA.fillEmailLinks(email);

    refs.statStreak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0));
    refs.statDays.textContent = String(DLA.safeGet(state, ["stats", "activeDays"], 0));
    refs.statCompletion.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
    refs.statAccuracy.textContent = String(DLA.safeGet(state, ["stats", "accuracy"], 0)) + "%";

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
      state = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
      if (!state || !state.profile) {
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
