(function todayPage() {
  var refs = {
    missingEmail: document.getElementById("missing-email"),
    todayContent: document.getElementById("today-content"),
    todayItemsCard: document.getElementById("today-items-card"),
    streak: document.getElementById("streak"),
    doneFlag: document.getElementById("done-flag"),
    completionRate: document.getElementById("completion-rate"),
    nextReminder: document.getElementById("next-reminder"),
    completeBtn: document.getElementById("complete-btn"),
    sendMorningBtn: document.getElementById("send-morning-btn"),
    sendEveningBtn: document.getElementById("send-evening-btn"),
    todayItems: document.getElementById("today-items"),
    quizForm: document.getElementById("quiz-form"),
    reviewPanel: document.getElementById("review-panel")
  };

  var email = "";
  var state = null;

  function getSessionFromState() {
    var sessionId = DLA.getParam("sessionId");
    var date = DLA.getParam("date");
    var history = state && Array.isArray(state.history) ? state.history : [];

    if (sessionId) {
      return history.filter(function (item) { return item.id === sessionId; })[0] || state.activeSession || null;
    }

    if (date) {
      return history.filter(function (item) { return item.date === date; })[0] || state.activeSession || null;
    }

    return state && state.activeSession ? state.activeSession : null;
  }

  function isCurrentSession(session) {
    return Boolean(session && state && state.activeSession && session.id === state.activeSession.id);
  }

  function renderMissing() {
    refs.missingEmail.hidden = false;
    refs.todayContent.hidden = true;
    refs.todayItemsCard.hidden = true;
  }

  function renderItems(session) {
    var items = session && Array.isArray(session.items) ? session.items : [];
    if (!items.length) {
      refs.todayItems.innerHTML = '<div class="empty">当前没有可展示的学习内容。</div>';
      return;
    }

    refs.todayItems.innerHTML = items.map(function (item, index) {
      var detail = "";
      if (item.type === "vocabulary") {
        detail = "中文：" + DLA.escapeHtml(item.chinese || "") + "<br>例句：" + DLA.escapeHtml(item.example || "");
      } else if (item.type === "spoken") {
        detail = "场景：" + DLA.escapeHtml(item.scene || "") + "<br>例句：" + DLA.escapeHtml(item.example || "");
      } else if (item.type === "ai_news") {
        detail = "要点：" + DLA.escapeHtml(item.summary || "") + "<br>启发：" + DLA.escapeHtml(item.takeaway || "");
      } else {
        detail = "摘要：" + DLA.escapeHtml(item.summary || "") + "<br>启发：" + DLA.escapeHtml(item.takeaway || "");
      }
      return [
        '<article class="list-item">',
        "<strong>" + (index + 1) + ". " + DLA.escapeHtml(item.headline || "") + "</strong>",
        '<div class="tiny">' + DLA.labelForType(item.type) + "</div>",
        '<p class="muted">' + detail + "</p>",
        "</article>"
      ].join("");
    }).join("");
  }

  function renderQuiz(session) {
    var quiz = session && session.quiz ? session.quiz : null;
    var questions = quiz && Array.isArray(quiz.questions) ? quiz.questions : [];
    if (!questions.length) {
      refs.quizForm.innerHTML = '<div class="empty">当前没有可提交的晚间复习题。</div>';
      return;
    }

    refs.quizForm.innerHTML = questions.map(function (question, index) {
      var options = (question.options || []).map(function (option) {
        return '<label class="list-item"><input type="radio" name="' + question.id + '" value="' + DLA.escapeHtml(option) + '"> ' + DLA.escapeHtml(option) + "</label>";
      }).join("");
      return '<div class="list-item"><strong>' + (index + 1) + ". " + DLA.escapeHtml(question.prompt) + '</strong><div class="list">' + options + "</div></div>";
    }).join("") + '<button class="btn" type="submit"><span>提交复习结果</span></button>';

    if (session && session.quizResult) {
      refs.quizForm.innerHTML += [
        '<div class="list-item">',
        '<div class="ok">已提交：' + DLA.escapeHtml(DLA.formatDateTime(session.quizResult.submittedAt)) + "</div>",
        "<div>得分：" + session.quizResult.score + "/" + session.quizResult.total + "</div>",
        "<div>正确率：" + session.quizResult.accuracy + "%</div>",
        "</div>"
      ].join("");
    }
  }

  function render() {
    var session = getSessionFromState();
    var isCurrent = isCurrentSession(session);

    refs.missingEmail.hidden = true;
    refs.todayContent.hidden = false;
    refs.todayItemsCard.hidden = false;

    DLA.fillEmailLinks(email);
    refs.streak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0)) + " 天";
    refs.completionRate.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
    refs.nextReminder.textContent = DLA.safeGet(state, ["profile", "sendTime"], "--:--");
    refs.doneFlag.textContent = session && session.completedAt ? "已完成" : "未完成";

    renderItems(session);
    renderQuiz(session);

    refs.completeBtn.disabled = !isCurrent;
    refs.sendMorningBtn.disabled = !state || !state.profile;
    refs.sendEveningBtn.disabled = !isCurrent;
    if (!isCurrent) {
      refs.completeBtn.title = "历史记录仅供查看";
      refs.sendEveningBtn.title = "只能对当日学习发送晚间复习";
    } else {
      refs.completeBtn.title = "";
      refs.sendEveningBtn.title = "";
    }
  }

  async function reloadState() {
    state = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
    if (state && state.profile) DLA.cacheState(email, state);
    render();
  }

  async function completeToday() {
    var session = getSessionFromState();
    var sessionId = session ? session.id : "";
    if (!sessionId || !isCurrentSession(session)) {
      DLA.showToast("历史记录页面不支持打卡，请回到当日学习。");
      return;
    }
    refs.completeBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/complete-session", {
        method: "POST",
        body: { email: email, sessionId: sessionId }
      });
      state = response.state;
      DLA.cacheState(email, state);
      render();
      DLA.showToast(response.message || "已记录今日完成");
    } catch (error) {
      DLA.showToast(error.message || "提交失败");
    } finally {
      refs.completeBtn.disabled = false;
    }
  }

  async function sendMorning() {
    refs.sendMorningBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/send/morning", { method: "POST", body: { email: email } });
      state = response.state;
      DLA.cacheState(email, state);
      render();
      DLA.showToast(response.message || "已发送今日内容");
    } catch (error) {
      DLA.showToast(error.message || "发送失败");
    } finally {
      refs.sendMorningBtn.disabled = false;
    }
  }

  async function sendEvening() {
    var session = getSessionFromState();
    if (!isCurrentSession(session)) {
      DLA.showToast("只能对当日学习发送晚间复习。");
      return;
    }
    refs.sendEveningBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/send/evening", { method: "POST", body: { email: email } });
      state = response.state;
      DLA.cacheState(email, state);
      render();
      DLA.showToast(response.message || "已发送晚间复习");
    } catch (error) {
      DLA.showToast(error.message || "发送失败");
    } finally {
      refs.sendEveningBtn.disabled = false;
    }
  }

  async function submitQuiz(event) {
    event.preventDefault();
    var session = getSessionFromState();
    var sessionId = session ? session.id : "";
    var questions = session && session.quiz && Array.isArray(session.quiz.questions) ? session.quiz.questions : [];
    if (!sessionId || !questions.length) return;

    var answers = questions.map(function (question) {
      var checked = refs.quizForm.querySelector('input[name="' + question.id + '"]:checked');
      return checked ? checked.value : "";
    });

    try {
      var response = await DLA.fetchJson("/api/quiz-submit", {
        method: "POST",
        body: { email: email, sessionId: sessionId, answers: answers }
      });
      state = response.state;
      DLA.cacheState(email, state);
      render();
      DLA.showToast(response.message || "复习结果已提交");
    } catch (error) {
      DLA.showToast(error.message || "提交失败");
    }
  }

  function bind() {
    refs.completeBtn.addEventListener("click", completeToday);
    refs.sendMorningBtn.addEventListener("click", sendMorning);
    refs.sendEveningBtn.addEventListener("click", sendEvening);
    refs.quizForm.addEventListener("submit", submitQuiz);
  }

  async function init() {
    bind();
    email = DLA.getEmailFromUrlOrStorage();
    if (!email) {
      renderMissing();
      return;
    }
    DLA.rememberEmail(email);

    try {
      await reloadState();
    } catch (error) {
      state = DLA.loadCachedState(email);
      if (state && state.profile) {
        render();
        DLA.showToast("当前读取的是本机缓存记录。");
      } else {
        DLA.showToast(error.message || "加载失败");
        renderMissing();
        return;
      }
    }

    if (DLA.getParam("panel") === "review" && refs.reviewPanel) {
      window.requestAnimationFrame(function () {
        refs.reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  init();
})();
