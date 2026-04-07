(function historyPage() {
  var refs = {
    historyEmpty: document.getElementById("history-empty"),
    historyContent: document.getElementById("history-content"),
    statStreak: document.getElementById("stat-streak"),
    statDays: document.getElementById("stat-days"),
    statCompletion: document.getElementById("stat-completion"),
    statAccuracy: document.getElementById("stat-accuracy"),
    timeline: document.getElementById("timeline"),
    accuracyChart: document.getElementById("accuracy-chart"),
    sessionList: document.getElementById("session-list"),
    sessionDetail: document.getElementById("session-detail"),
    wrongbookList: document.getElementById("wrongbook-list"),
    recordsTab: document.getElementById("history-tab-records"),
    wrongbookTab: document.getElementById("history-tab-wrongbook"),
    recordsPanel: document.getElementById("history-records-panel"),
    wrongbookPanel: document.getElementById("history-wrongbook-panel")
  };

  var email = "";
  var state = null;
  var activeTab = "records";

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
      if (session.quizResult && session.quizResult.submittedAt) quizDoneMap[session.date] = true;
    });

    var cells = [];
    var offset;
    for (offset = 0; offset < startWeekday; offset += 1) cells.push({ day: "", muted: true, checked: false });
    var day;
    for (day = 1; day <= daysInMonth; day += 1) {
      var dateKey = [year, String(month + 1).padStart(2, "0"), String(day).padStart(2, "0")].join("-");
      cells.push({ day: day, muted: false, checked: Boolean(quizDoneMap[dateKey]) });
    }
    while (cells.length % 7 !== 0) cells.push({ day: "", muted: true, checked: false });
    return cells;
  }

  function renderCalendar() {
    var weekdayLabels = ["日", "一", "二", "三", "四", "五", "六"];
    var cells = buildCalendarDays();
    refs.timeline.innerHTML = [
      '<div class="calendar-grid compact">',
      weekdayLabels.map(function (label) { return '<div class="calendar-head">' + label + "</div>"; }).join(""),
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

  function last7AccuracyPoints() {
    var sessions = state && Array.isArray(state.history) ? state.history : [];
    var map = {};
    sessions.forEach(function (s) {
      if (!s || !s.date) return;
      map[s.date] = s && s.quizResult ? Number(s.quizResult.accuracy || 0) : 0;
    });

    var points = [];
    var i;
    for (i = 6; i >= 0; i -= 1) {
      var d = new Date();
      d.setDate(d.getDate() - i);
      var key = [d.getFullYear(), String(d.getMonth() + 1).padStart(2, "0"), String(d.getDate()).padStart(2, "0")].join("-");
      points.push({
        key: key,
        label: String(d.getMonth() + 1).padStart(2, "0") + "/" + String(d.getDate()).padStart(2, "0"),
        value: map[key] || 0
      });
    }
    return points;
  }

  function renderAccuracyChart() {
    var points = last7AccuracyPoints();
    var width = 420;
    var height = 180;
    var padLeft = 34;
    var padRight = 14;
    var padTop = 16;
    var padBottom = 30;
    var drawW = width - padLeft - padRight;
    var drawH = height - padTop - padBottom;

    var poly = points.map(function (p, idx) {
      var x = padLeft + (idx * drawW / Math.max(1, points.length - 1));
      var y = padTop + (drawH * (1 - (Math.max(0, Math.min(100, p.value)) / 100)));
      return x.toFixed(2) + "," + y.toFixed(2);
    }).join(" ");

    var dots = points.map(function (p, idx) {
      var x = padLeft + (idx * drawW / Math.max(1, points.length - 1));
      var y = padTop + (drawH * (1 - (Math.max(0, Math.min(100, p.value)) / 100)));
      return '<circle cx="' + x.toFixed(2) + '" cy="' + y.toFixed(2) + '" r="3.5"></circle>';
    }).join("");

    var labels = points.map(function (p, idx) {
      var x = padLeft + (idx * drawW / Math.max(1, points.length - 1));
      return '<text x="' + x.toFixed(2) + '" y="' + (height - 10) + '" text-anchor="middle">' + DLA.escapeHtml(p.label) + "</text>";
    }).join("");

    var rows = [0, 25, 50, 75, 100].map(function (v) {
      var y = padTop + (drawH * (1 - (v / 100)));
      return [
        '<line x1="' + padLeft + '" y1="' + y.toFixed(2) + '" x2="' + (width - padRight) + '" y2="' + y.toFixed(2) + '"></line>',
        '<text x="' + (padLeft - 6) + '" y="' + (y + 4).toFixed(2) + '" text-anchor="end">' + v + "</text>"
      ].join("");
    }).join("");

    refs.accuracyChart.innerHTML = [
      '<div class="chart-title">复习正确率（最近 7 天）</div>',
      '<svg viewBox="0 0 ' + width + " " + height + '" class="line-chart" role="img" aria-label="最近7天复习正确率折线图">',
      '<g class="chart-grid">' + rows + "</g>",
      '<polyline class="chart-line" points="' + poly + '"></polyline>',
      '<g class="chart-dots">' + dots + "</g>",
      '<g class="chart-labels">' + labels + "</g>",
      "</svg>"
    ].join("");
  }

  function buildSessionHref(session) {
    return "/today?email=" + encodeURIComponent(email) + "&date=" + encodeURIComponent(session.date || "");
  }

  function renderRecords() {
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

  function buildWrongBookFallback() {
    var fallbackMap = new Map();
    var sessions = state && Array.isArray(state.history) ? state.history : [];
    sessions.forEach(function (session) {
      var wrongItems = session && session.quizResult && Array.isArray(session.quizResult.wrongItems)
        ? session.quizResult.wrongItems
        : [];
      wrongItems.forEach(function (item) {
        var prompt = String(item && item.prompt || "");
        var correct = String(item && item.correctAnswer || "");
        if (!prompt || !correct) return;
        var key = prompt + "__" + correct;
        var prev = fallbackMap.get(key);
        if (!prev) {
          fallbackMap.set(key, {
            id: String(item && item.id || key),
            prompt: prompt,
            correctAnswer: correct,
            lastAnswer: String(item && item.answer || ""),
            hint: String(item && item.hint || ""),
            wrongCount: 1,
            lastWrongAt: session && session.quizResult ? session.quizResult.submittedAt : null,
            sessionDate: session && session.date ? session.date : ""
          });
          return;
        }
        prev.wrongCount = Number(prev.wrongCount || 1) + 1;
        prev.lastAnswer = String(item && item.answer || prev.lastAnswer || "");
        prev.hint = String(item && item.hint || prev.hint || "");
        prev.lastWrongAt = session && session.quizResult && session.quizResult.submittedAt
          ? session.quizResult.submittedAt
          : prev.lastWrongAt;
        if (!prev.sessionDate && session && session.date) prev.sessionDate = session.date;
        fallbackMap.set(key, prev);
      });
    });
    return Array.from(fallbackMap.values());
  }

  function renderWrongbook() {
    var wrongBook = state && Array.isArray(state.wrongBook) ? state.wrongBook.slice() : [];
    if (!wrongBook.length) wrongBook = buildWrongBookFallback();
    if (!wrongBook.length) {
      refs.wrongbookList.innerHTML = '<div class="empty">暂无错题，继续保持。</div>';
      return;
    }

    refs.wrongbookList.innerHTML = wrongBook.map(function (item, index) {
      var dateText = item.lastWrongAt ? DLA.formatDateTime(item.lastWrongAt) : "--";
      return [
        '<article class="list-item">',
        "<strong>" + (index + 1) + ". " + DLA.escapeHtml(item.prompt || "") + "</strong>",
        '<p class="muted">正确答案：' + DLA.escapeHtml(item.correctAnswer || "--") + "</p>",
        '<p class="muted">最近错误答案：' + DLA.escapeHtml(item.lastAnswer || "--") + "</p>",
        '<p class="muted">错误次数：' + DLA.escapeHtml(String(item.wrongCount || 1)) + "</p>",
        '<p class="tiny">最近出错时间：' + DLA.escapeHtml(dateText) + "</p>",
        item.hint ? ('<p class="muted">提示：' + DLA.escapeHtml(item.hint) + "</p>") : "",
        item.sessionDate ? ('<p><a class="btn btn-alt" href="/today?email=' + encodeURIComponent(email) + '&date=' + encodeURIComponent(item.sessionDate) + '"><span>回看该日内容</span></a></p>') : "",
        "</article>"
      ].join("");
    }).join("");
  }

  function setActiveTab(tab) {
    activeTab = tab === "wrongbook" ? "wrongbook" : "records";
    var isRecords = activeTab === "records";

    if (refs.recordsPanel) refs.recordsPanel.hidden = !isRecords;
    if (refs.wrongbookPanel) refs.wrongbookPanel.hidden = isRecords;

    if (refs.recordsTab) {
      refs.recordsTab.classList.toggle("is-active", isRecords);
      refs.recordsTab.setAttribute("aria-selected", isRecords ? "true" : "false");
    }
    if (refs.wrongbookTab) {
      refs.wrongbookTab.classList.toggle("is-active", !isRecords);
      refs.wrongbookTab.setAttribute("aria-selected", isRecords ? "false" : "true");
    }
  }

  function render() {
    refs.historyEmpty.hidden = true;
    refs.historyContent.hidden = false;
    DLA.fillEmailLinks(email);
    refs.statStreak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0));
    refs.statDays.textContent = String(DLA.safeGet(state, ["stats", "activeDays"], 0));
    refs.statCompletion.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
    refs.statAccuracy.textContent = String(DLA.safeGet(state, ["stats", "accuracy"], 0)) + "%";

    renderCalendar();
    renderAccuracyChart();
    renderRecords();
    renderWrongbook();
    setActiveTab(activeTab);
  }

  function showEmpty() {
    refs.historyEmpty.hidden = false;
    refs.historyContent.hidden = true;
  }

  function bind() {
    if (refs.recordsTab) refs.recordsTab.addEventListener("click", function () { setActiveTab("records"); });
    if (refs.wrongbookTab) refs.wrongbookTab.addEventListener("click", function () { setActiveTab("wrongbook"); });
  }

  async function loadStateWithRestore() {
    var remote = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
    if (remote && remote.profile) {
      state = remote;
      DLA.cacheState(email, state);
      return;
    }
    var cached = DLA.loadCachedState(email);
    if (cached && cached.profile) {
      var restored = await DLA.restoreState(email, cached);
      state = restored && restored.profile ? restored : cached;
      DLA.cacheState(email, state);
      return;
    }
    state = remote;
  }

  async function init() {
    bind();
    email = DLA.getEmailFromUrlOrStorage();
    if (!email) {
      showEmpty();
      return;
    }

    DLA.rememberEmail(email);
    try {
      await loadStateWithRestore();
      if (!state || !state.profile) {
        showEmpty();
        return;
      }
      render();
    } catch (error) {
      state = DLA.loadCachedState(email);
      if (state && state.profile) {
        var restored = await DLA.restoreState(email, state);
        if (restored && restored.profile) state = restored;
        DLA.cacheState(email, state);
        render();
        DLA.showToast("当前使用本机缓存记录，已尝试自动恢复。");
        return;
      }
      DLA.showToast(error.message || "加载失败");
      showEmpty();
    }
  }

  init();
})();
