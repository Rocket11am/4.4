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

  function getActiveSession() {
    return state && state.activeSession ? state.activeSession : null;
  }

  function renderMissing() {
    refs.missingEmail.hidden = false;
    refs.todayContent.hidden = true;
    refs.todayItemsCard.hidden = true;
  }

  function renderItems() {
    var session = getActiveSession();
    var items = session && Array.isArray(session.items) ? session.items : [];
    if (!items.length) {
      refs.todayItems.innerHTML = '<div class="empty">今日内容尚未生成，点击“发送今日内容”后会出现。</div>';
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

  function renderQuiz() {
    var session = getActiveSession();
    var quiz = session && session.quiz ? session.quiz : null;
    var questions = quiz && Array.isArray(quiz.questions) ? quiz.questions : [];
    if (!questions.length) {
      refs.quizForm.innerHTML = '<div class="empty">当前没有可提交的晚间复习题。</div>';
      return;
    }

    refs.quizForm.innerHTML = questions.map(function (question, index) {
      if (question.type === "choice") {
        var options = (question.options || []).map(function (option) {
          return '<label class="list-item"><input type="radio" name="' + question.id + '" value="' + DLA.escapeHtml(option) + '"> ' + DLA.escapeHtml(option) + "</label>";
        }).join("");
        return '<div class="list-item"><strong>' + (index + 1) + ". " + DLA.escapeHtml(question.prompt) + '</strong><div class="list">' + options + "</div></div>";
      }
      return '<div class="list-item"><strong>' + (index + 1) + ". " + DLA.escapeHtml(question.prompt) + '</strong><input class="input" type="text" name="' + question.id + '" placeholder="' + DLA.escapeHtml(question.hint || "请输入答案") + '"></div>';
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
    refs.missingEmail.hidden = true;
    refs.todayContent.hidden = false;
    refs.todayItemsCard.hidden = false;

    DLA.fillEmailLinks(email);
    refs.streak.textContent = String(DLA.safeGet(state, ["stats", "streak"], 0)) + " 天";
    refs.completionRate.textContent = String(DLA.safeGet(state, ["stats", "completionRate"], 0)) + "%";
    refs.nextReminder.textContent = DLA.safeGet(state, ["profile", "sendTime"], "--:--");
    refs.doneFlag.textContent = DLA.safeGet(state, ["activeSession", "completedAt"], "") ? "已完成" : "未完成";
    renderItems();
    renderQuiz();

    refs.completeBtn.disabled = !DLA.safeGet(state, ["activeSession", "id"], "");
  }

  async function reloadState() {
    state = await DLA.fetchJson("/api/state?email=" + encodeURIComponent(email));
    render();
  }

  async function completeToday() {
    var sessionId = DLA.safeGet(state, ["activeSession", "id"], "");
    if (!sessionId) {
      DLA.showToast("当前没有可完成的学习内容");
      return;
    }
    refs.completeBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/complete-session", {
        method: "POST",
        body: { email: email, sessionId: sessionId }
      });
      state = response.state;
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
      render();
      DLA.showToast(response.message || "已发送今日内容");
    } catch (error) {
      DLA.showToast(error.message || "发送失败");
    } finally {
      refs.sendMorningBtn.disabled = false;
    }
  }

  async function sendEvening() {
    refs.sendEveningBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/send/evening", { method: "POST", body: { email: email } });
      state = response.state;
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
    var session = getActiveSession();
    var sessionId = session ? session.id : "";
    var questions = session && session.quiz && Array.isArray(session.quiz.questions) ? session.quiz.questions : [];
    if (!sessionId || !questions.length) return;

    var answers = questions.map(function (question) {
      if (question.type === "choice") {
        var checked = refs.quizForm.querySelector('input[name="' + question.id + '"]:checked');
        return checked ? checked.value : "";
      }
      var input = refs.quizForm.querySelector('input[name="' + question.id + '"]');
      return input ? input.value : "";
    });

    try {
      var response = await DLA.fetchJson("/api/quiz-submit", {
        method: "POST",
        body: { email: email, sessionId: sessionId, answers: answers }
      });
      state = response.state;
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
      DLA.showToast(error.message || "加载失败");
      renderMissing();
      return;
    }

    if (DLA.getParam("panel") === "review" && refs.reviewPanel) {
      window.requestAnimationFrame(function () {
        refs.reviewPanel.scrollIntoView({ behavior: "smooth", block: "start" });
      });
    }
  }

  init();
})();
