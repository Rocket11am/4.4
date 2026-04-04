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

  function buildCalendarDays() {
    var today = new Date();
    var year = today.getFullYear();
    var month = today.getMonth();
    var firstDay = new Date(year, month, 1);
    var startWeekday = firstDay.getDay();
    var daysInMonth = new Date(year, month + 1, 0).getDate();
    var sessions = state && Array.isArray(state.history) ? state.history : [];
    var quizDoneMap = {};
    sessions.forEach(function (session) {
      if (!session || !session.date) return;
      if (session.quizResult && session.quizResult.submittedAt) {
        quizDoneMap[session.date] = true;
      }
    });

    var cells = [];
    var offset;
    for (offset = 0; offset < startWeekday; offset += 1) {
      cells.push({ day: "", muted: true, checked: false });
    }

    var day;
    for (day = 1; day <= daysInMonth; day += 1) {
      var dateKey = [
        year,
        String(month + 1).padStart(2, "0"),
        String(day).padStart(2, "0")
      ].join("-");
      cells.push({
        day: day,
        muted: false,
        checked: Boolean(quizDoneMap[dateKey])
      });
    }

    while (cells.length % 7 !== 0) {
      cells.push({ day: "", muted: true, checked: false });
    }

    return cells;
  }

  function renderTimeline() {
    var weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    var cells = buildCalendarDays();
    refs.timeline.innerHTML = [
      '<div class="calendar-grid">',
      weekdayLabels.map(function (label) {
        return '<div class="calendar-head">' + label + "</div>";
      }).join(""),
      cells.map(function (cell) {
        return [
          '<div class="calendar-cell ' + (cell.muted ? "is-muted" : "") + " " + (cell.checked ? "is-done" : "") + '">',
          '<div class="calendar-day">' + (cell.day || "") + "</div>",
          cell.checked ? '<div class="calendar-mark">✓</div>' : "",
          "</div>"
        ].join("");
      }).join(""),
      "</div>"
    ].join("");
  }

  function buildSessionHref(session) {
    return "/today?email=" + encodeURIComponent(email) + "&date=" + encodeURIComponent(session.date || "");
  }

  function renderList() {
    var list = state && Array.isArray(state.history) ? state.history : [];
    if (!list.length) {
      refs.sessionList.innerHTML = '<div class="empty">暂无历史记录。</div>';
      refs.sessionDetail.innerHTML = '<div class="empty">暂无详情。</div>';
      return;
    }

    refs.sessionList.innerHTML = list.map(function (session) {
      var types = (session.learningTypes || []).map(DLA.labelForType).join(" / ");
      var reviewLabel = session.quizResult ? (session.quizResult.accuracy + "%") : "未测验";
      return [
        '<a class="session-link" href="' + buildSessionHref(session) + '">',
        "<strong>" + DLA.escapeHtml(session.date) + "</strong>",
        '<div class="tiny">' + DLA.escapeHtml(types) + "</div>",
        '<div class="tiny">' + (session.completedAt ? "已完成" : "未完成") + " / " + reviewLabel + "</div>",
        "</a>"
      ].join("");
    }).join("");

    var target = list[0];
    var morning = target && target.delivery ? target.delivery.morning : null;
    var evening = target && target.delivery ? target.delivery.evening : null;
    var typesText = (target.learningTypes || []).map(DLA.labelForType).join(" / ");
    var quizText = target.quizResult
      ? (target.quizResult.score + "/" + target.quizResult.total + "，" + target.quizResult.accuracy + "%")
      : "未提交";

    refs.sessionDetail.innerHTML = [
      '<article class="list-item">',
      "<strong>" + DLA.escapeHtml(target.date || "--") + "</strong>",
      '<p class="muted">学习类型：' + DLA.escapeHtml(typesText || "--") + "</p>",
      '<p class="muted">完成时间：' + DLA.escapeHtml(DLA.formatDateTime(target.completedAt)) + "</p>",
      '<p class="muted">晨间邮件：' + (morning ? ("打开 " + (morning.opens || 0) + " / 点击 " + (morning.clicks || 0)) : "未发送") + "</p>",
      '<p class="muted">晚间邮件：' + (evening ? ("打开 " + (evening.opens || 0) + " / 点击 " + (evening.clicks || 0)) : "未发送") + "</p>",
      '<p class="muted">测验结果：' + quizText + "</p>",
      '<div class="detail-actions"><a class="btn" href="' + buildSessionHref(target) + '"><span>查看当日学习内容</span></a></div>',
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
      if (state && state.profile) {
        DLA.cacheState(email, state);
      } else {
        state = DLA.loadCachedState(email);
      }
      if (!state || !state.profile) {
        showEmpty();
        return;
      }
      render();
    } catch (error) {
      state = DLA.loadCachedState(email);
      if (state && state.profile) {
        render();
        DLA.showToast("当前读取的是本机缓存记录。");
        return;
      }
      DLA.showToast(error.message || "加载失败");
      showEmpty();
    }
  }

  init();
})();
