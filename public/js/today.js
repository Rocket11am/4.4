(function todayPage() {
  var refs = {
    missingEmail: document.getElementById("missing-email"),
    todayContent: document.getElementById("today-content"),
    todayItemsCard: document.getElementById("today-items-card"),
    streak: document.getElementById("streak"),
    doneFlag: document.getElementById("done-flag"),
    completionRate: document.getElementById("completion-rate"),
    nextReminder: document.getElementById("next-reminder"),
    eveningReminder: document.getElementById("evening-reminder"),
    completeBtn: document.getElementById("complete-btn"),
    sendMorningBtn: document.getElementById("send-morning-btn"),
    sendEveningBtn: document.getElementById("send-evening-btn"),
    todayItems: document.getElementById("today-items"),
    quizForm: document.getElementById("quiz-form"),
    quizWrong: document.getElementById("quiz-wrong"),
    reviewPanel: document.getElementById("review-panel"),
    petAvatar: document.getElementById("pet-avatar"),
    petName: document.getElementById("pet-name"),
    petStageLabel: document.getElementById("pet-stage-label"),
    petAge: document.getElementById("pet-age"),
    petLevel: document.getElementById("pet-level"),
    petFeeds: document.getElementById("pet-feeds"),
    petFedToday: document.getElementById("pet-fed-today"),
    petMood: document.getElementById("pet-mood"),
    petProgressText: document.getElementById("pet-progress-text"),
    petProgressBar: document.getElementById("pet-progress-bar"),
    petNextTip: document.getElementById("pet-next-tip")
  };

  var email = "";
  var state = null;

  function getSessionFromState() {
    var sessionId = DLA.getParam("sessionId");
    var date = DLA.getParam("date");
    var history = state && Array.isArray(state.history) ? state.history : [];
    if (sessionId) return history.filter(function (item) { return item.id === sessionId; })[0] || state.activeSession || null;
    if (date) return history.filter(function (item) { return item.date === date; })[0] || state.activeSession || null;
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
    var questions = session && session.quiz && Array.isArray(session.quiz.questions) ? session.quiz.questions : [];
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
  }

  function renderQuizWrong(session) {
    var wrongItems = session && session.quizResult && Array.isArray(session.quizResult.wrongItems) ? session.quizResult.wrongItems : [];
    if (!wrongItems.length) {
      refs.quizWrong.innerHTML = '<div class="empty">本次复习无错题，继续保持。</div>';
      return;
    }
    refs.quizWrong.innerHTML = [
      '<article class="list-item"><strong>本次错题</strong></article>',
      wrongItems.map(function (item, idx) {
        return [
          '<article class="list-item">',
          '<div><strong>' + (idx + 1) + ". " + DLA.escapeHtml(item.prompt || "") + "</strong></div>",
          '<p class="muted">你的答案：' + DLA.escapeHtml(item.answer || "(未作答)") + "</p>",
          '<p class="muted">正确答案：' + DLA.escapeHtml(item.correctAnswer || "--") + "</p>",
          item.hint ? '<p class="muted">提示：' + DLA.escapeHtml(item.hint) + "</p>" : "",
          "</article>"
        ].join("");
      }).join("")
    ].join("");
  }
  function renderPet() {
    var pet = state && state.pet ? state.pet : null;
    if (!pet) return;
    refs.petName.textContent = pet.name || "小闪电";
    refs.petStageLabel.textContent = pet.stageLabel || "像素幼宠";
    refs.petAge.textContent = String(pet.age || 1) + " 岁";
    refs.petLevel.textContent = "Lv." + String(pet.level || 1);
    refs.petFeeds.textContent = String(pet.lifetimeFeeds || 0) + " 次";
    refs.petFedToday.textContent = pet.fedToday ? "已喂养" : "未喂养";
    refs.petMood.textContent = pet.mood || "等待投喂";
    refs.petProgressText.textContent = String(pet.progressDays || 0) + " / 10";
    refs.petProgressBar.style.width = Math.max(0, Math.min(100, (Number(pet.progressDays || 0) / 10) * 100)) + "%";
    refs.petNextTip.textContent = pet.daysToNextLevel === 10
      ? "再连续完成 10 天，宠物会成长一级。"
      : ("再连续完成 " + String(pet.daysToNextLevel || 0) + " 天，宠物会成长一级。");
    refs.petAvatar.className = "pet-avatar pet-stage-" + (pet.stage || "seed");
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
    refs.eveningReminder.textContent = DLA.safeGet(state, ["profile", "reviewTime"], "--:--");
    refs.doneFlag.textContent = session && session.completedAt ? "已完成" : "未完成";

    renderItems(session);
    renderQuiz(session);
    renderQuizWrong(session);
    renderPet();

    refs.completeBtn.disabled = !isCurrent;
    refs.sendMorningBtn.disabled = !state || !state.profile;
    refs.sendEveningBtn.disabled = !isCurrent;
    refs.completeBtn.title = isCurrent ? "" : "历史记录仅供查看";
    refs.sendEveningBtn.title = isCurrent ? "" : "只能对当日学习发送晚间复习";
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

  async function completeToday() {
    var session = getSessionFromState();
    var sessionId = session ? session.id : "";
    if (!sessionId || !isCurrentSession(session)) {
      DLA.showToast("历史记录页面不支持打卡，请回到当日学习。");
      return;
    }
    refs.completeBtn.disabled = true;
    try {
      var response = await DLA.fetchJson("/api/complete-session", { method: "POST", body: { email: email, sessionId: sessionId } });
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
      var response = await DLA.fetchJson("/api/quiz-submit", { method: "POST", body: { email: email, sessionId: sessionId, answers: answers } });
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
      await loadStateWithRestore();
      if (!state || !state.profile) {
        renderMissing();
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
