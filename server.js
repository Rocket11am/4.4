const http = require("http");
const fs = require("fs");
const path = require("path");
const tls = require("tls");
const net = require("net");
const { URL } = require("url");

const PORT = Number(process.env.PORT || 3000);
const ROOT = __dirname;
const PUBLIC_DIR = path.join(ROOT, "public");
const RUNTIME_ROOT = process.env.VERCEL ? (process.env.TMPDIR || "/tmp") : ROOT;
const DATA_DIR = process.env.VERCEL ? path.join(RUNTIME_ROOT, "daily-learning-assistant-data") : path.join(ROOT, "data");
const STORE_PATH = path.join(DATA_DIR, "store.json");
const CONTENT_PATH = path.join(DATA_DIR, "content.json");
const TRACKING_GIF = Buffer.from("R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==", "base64");
const ARK_API_KEY = String(process.env.ARK_API_KEY || "").trim();
const ARK_BASE_URL = String(process.env.ARK_BASE_URL || "https://ark.cn-beijing.volces.com/api/v3").trim().replace(/\/$/, "");
const ARK_MODEL = String(process.env.ARK_MODEL || process.env.ARK_ENDPOINT_ID || "").trim();
const ARK_TIMEOUT_MS = Number(process.env.ARK_TIMEOUT_MS || 45000);

const TYPE_META = {
  vocabulary: { label: "单词记忆", reviewEligible: true, accent: "#FF3AF2" },
  spoken: { label: "地道口语表达", reviewEligible: true, accent: "#00F5D4" },
  finance: { label: "每日财经资讯", reviewEligible: false, accent: "#FFE600" },
  ai_news: { label: "每日AI前沿资讯", reviewEligible: false, accent: "#7B2FFF" },
  custom: { label: "自定义主题", reviewEligible: false, accent: "#FF6B35" }
};

const LEGACY_TYPE_MAP = {
  vocabulary: "vocabulary",
  spoken: "spoken",
  finance: "finance",
  "ai-news": "ai_news",
  ai_news: "ai_news",
  ai: "ai_news",
  aifrontier: "ai_news",
  "ai_frontier": "ai_news",
  custom: "custom",
  business: "spoken",
  travel: "spoken",
  writing: "spoken"
};

ensureDir(DATA_DIR);
ensureFile(CONTENT_PATH, JSON.stringify(seedContent(), null, 2));
ensureFile(STORE_PATH, JSON.stringify(seedStore(), null, 2));

let store = normalizeStore(loadJson(STORE_PATH, seedStore()));
let contentPool = normalizeContentPool(loadJson(CONTENT_PATH, seedContent()));
let schedulerMinuteKey = "";

async function requestListener(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    if (url.pathname.startsWith("/api/")) {
      await handleApi(req, res, url);
      return;
    }
    serveStatic(res, url.pathname);
  } catch (error) {
    console.error(error);
    respondJson(res, 500, { ok: false, message: error.message || "服务器异常" });
  }
}

if (require.main === module) {
  const server = http.createServer(requestListener);
  server.listen(PORT, () => {
    console.log(`Daily Learning Assistant is running at http://localhost:${PORT}`);
    runSchedulerCheck();
    setInterval(runSchedulerCheck, 30 * 1000);
  });
}

async function handleApi(req, res, url) {
  if (req.method === "GET" && url.pathname === "/api/cron") {
    runSchedulerCheck();
    respondJson(res, 200, { ok: true, message: "scheduler triggered" });
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/state") {
    respondJson(res, 200, buildClientState(url.searchParams.get("email")));
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/ai-health") {
    const health = await checkArkHealth();
    respondJson(res, 200, health);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/email-open") {
    markDeliveryOpen(url.searchParams.get("email"), url.searchParams.get("sessionId"), url.searchParams.get("slot"));
    res.writeHead(200, {
      "Content-Type": "image/gif",
      "Content-Length": TRACKING_GIF.length,
      "Cache-Control": "no-store, max-age=0"
    });
    res.end(TRACKING_GIF);
    return;
  }

  if (req.method === "GET" && url.pathname === "/api/email-click") {
    const email = url.searchParams.get("email");
    const sessionId = url.searchParams.get("sessionId");
    const slot = url.searchParams.get("slot");
    const action = String(url.searchParams.get("action") || "");
    const redirect = sanitizeRedirect(url.searchParams.get("redirect"), email);

    markDeliveryClick(email, sessionId, slot);
    if (action === "complete") {
      completeSessionInternal(email, sessionId, "email");
    }

    res.writeHead(302, { Location: redirect });
    res.end();
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/profile") {
    const body = await readBody(req);
    const user = upsertUser(body);
    saveStore();
    respondJson(res, 200, buildClientState(user.email));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/restore-state") {
    const body = await readBody(req);
    respondJson(res, 200, restoreUserState(body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/send/morning") {
    const body = await readBody(req);
    respondJson(res, 200, await sendMorningLesson(body.email, "manual"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/send/evening") {
    const body = await readBody(req);
    respondJson(res, 200, await sendEveningReview(body.email, "manual"));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/complete-session") {
    const body = await readBody(req);
    respondJson(res, 200, completeSession(body));
    return;
  }

  if (req.method === "POST" && url.pathname === "/api/quiz-submit") {
    const body = await readBody(req);
    respondJson(res, 200, submitQuiz(body));
    return;
  }

  respondJson(res, 404, { ok: false, message: "未找到接口" });
}

function serveStatic(res, pathname) {
  const routeMap = {
    "/": "/index.html",
    "/onboarding": "/settings.html",
    "/today": "/today.html",
    "/history": "/history.html",
    "/settings": "/settings.html"
  };

  const decodedPath = safeDecode(pathname || "/");
  const mappedPath = routeMap[decodedPath] || decodedPath;
  const safePath = mappedPath.endsWith("/") ? `${mappedPath}index.html` : mappedPath;
  const normalizedPath = path
    .normalize(safePath)
    .replace(/^[/\\]+/, "")
    .replace(/^(\.\.[/\\])+/, "");
  const filePath = path.join(PUBLIC_DIR, normalizedPath);
  if (!filePath.startsWith(PUBLIC_DIR) || !fs.existsSync(filePath) || fs.statSync(filePath).isDirectory()) {
    respondText(res, 404, "Not found");
    return;
  }

  const ext = path.extname(filePath).toLowerCase();
  const contentType = {
    ".html": "text/html; charset=utf-8",
    ".css": "text/css; charset=utf-8",
    ".js": "application/javascript; charset=utf-8",
    ".json": "application/json; charset=utf-8"
  }[ext] || "application/octet-stream";

  res.writeHead(200, { "Content-Type": contentType });
  fs.createReadStream(filePath).pipe(res);
}

function buildClientState(email) {
  const cleanEmail = normalizeEmail(email);
  const user = cleanEmail ? getUser(cleanEmail) : null;
  const sessions = user ? sortSessions(user.sessions).map(normalizeSession) : [];
  const activeSession = sessions[0] || null;
  const stats = user ? buildStats(user, sessions) : emptyStats();
  const pet = buildPetState(user, sessions, stats);

  return {
    ok: true,
    profile: user
      ? {
          email: user.email,
          dailyCount: user.preferences.dailyCount,
          learningTypes: user.preferences.learningTypes,
          customTopic: user.preferences.customTopic,
          petName: user.preferences.petName,
          sendTime: user.preferences.sendTime,
          reviewEnabled: user.preferences.reviewEnabled,
          reviewTime: user.preferences.reviewTime,
          backupChannel: user.preferences.backupChannel,
          backupContact: user.preferences.backupContact
        }
      : null,
    stats,
    pet,
    activeSession,
    history: sessions,
    timeline: buildTimeline(sessions),
    logs: [...store.logs].reverse().slice(0, 8),
    availableTypes: Object.entries(TYPE_META).map(([id, meta]) => ({
      id,
      label: meta.label,
      reviewEligible: meta.reviewEligible
    }))
  };
}

function emptyStats() {
  return {
    streak: 0,
    totalSessions: 0,
    completedSessions: 0,
    completionRate: 0,
    quizzesCompleted: 0,
    reviewRate: 0,
    accuracy: 0,
    activeDays: 0,
    currentLevel: 1,
    emailSent: 0,
    emailOpened: 0,
    emailClicked: 0,
    openRate: 0,
    clickRate: 0
  };
}

function buildPetState(user, sessions, stats) {
  const completedSessions = sessions.filter((session) => session.completedAt);
  const currentStreak = Number(stats?.streak || 0);
  const lifetimeFeeds = completedSessions.length;
  const milestoneAge = 1 + Math.floor(currentStreak / 10);
  const storedAge = Number(user?.pet?.age || 1);
  const age = Math.max(1, storedAge, milestoneAge);
  const level = age;
  const progressDays = currentStreak % 10;
  const daysToNextLevel = progressDays === 0 ? 10 : 10 - progressDays;
  const stage = getPetStage(age);

  return {
    name: String(user?.preferences?.petName || user?.pet?.name || "小闪电").trim() || "小闪电",
    age,
    level,
    stage: stage.id,
    stageLabel: stage.label,
    mood: currentStreak >= 3 ? "活力满满" : "等待投喂",
    currentStreak,
    lifetimeFeeds,
    progressDays,
    daysToNextLevel,
    fedToday: completedSessions.some((session) => session.date === formatDateKey(new Date()))
  };
}

function getPetStage(age) {
  if (age >= 7) return { id: "legend", label: "机甲成长体" };
  if (age >= 3) return { id: "spark", label: "机甲进阶体" };
  return { id: "seed", label: "像素幼宠" };
}

function buildStats(user, sessions) {
  const completedSessions = sessions.filter((session) => session.completedAt);
  const answeredSessions = sessions.filter((session) => session.quizResult && Number.isFinite(session.quizResult.accuracy));
  const reviewEligibleSessions = sessions.filter((session) => session.reviewEligible);
  const deliveries = sessions.flatMap((session) => [session.delivery?.morning, session.delivery?.evening].filter(Boolean));
  const emailSent = deliveries.length;
  const emailOpened = deliveries.filter((delivery) => delivery.openedAt || delivery.opens > 0).length;
  const emailClicked = deliveries.filter((delivery) => delivery.clickedAt || delivery.clicks > 0).length;
  const accuracy = answeredSessions.length
    ? Math.round(answeredSessions.reduce((sum, session) => sum + session.quizResult.accuracy, 0) / answeredSessions.length)
    : 0;
  const currentLevel = deriveDifficultyLevel(user);

  user.currentLevel = currentLevel;

  return {
    streak: computeStreak(completedSessions),
    totalSessions: sessions.length,
    completedSessions: completedSessions.length,
    completionRate: sessions.length ? Math.round((completedSessions.length / sessions.length) * 100) : 0,
    quizzesCompleted: answeredSessions.length,
    reviewRate: reviewEligibleSessions.length ? Math.round((answeredSessions.length / reviewEligibleSessions.length) * 100) : 0,
    accuracy,
    activeDays: new Set(sessions.map((session) => session.date)).size,
    currentLevel,
    emailSent,
    emailOpened,
    emailClicked,
    openRate: emailSent ? Math.round((emailOpened / emailSent) * 100) : 0,
    clickRate: emailSent ? Math.round((emailClicked / emailSent) * 100) : 0
  };
}

function buildTimeline(sessions) {
  const map = new Map();
  sessions.forEach((session) => {
    const current = map.get(session.date) || { sent: 0, completed: false, accuracySamples: [] };
    current.sent += 1;
    current.completed = current.completed || Boolean(session.completedAt);
    if (session.quizResult && Number.isFinite(session.quizResult.accuracy)) {
      current.accuracySamples.push(session.quizResult.accuracy);
    }
    map.set(session.date, current);
  });

  return lastNDates(7).map((dateKey) => {
    const current = map.get(dateKey) || { sent: 0, completed: false, accuracySamples: [] };
    const accuracy = current.accuracySamples.length
      ? Math.round(current.accuracySamples.reduce((sum, value) => sum + value, 0) / current.accuracySamples.length)
      : 0;

    return {
      date: dateKey,
      label: dateKey.slice(5).replace("-", "/"),
      sent: current.sent,
      completed: current.completed,
      accuracy
    };
  });
}

function sortSessions(sessions) {
  return [...(Array.isArray(sessions) ? sessions : [])].sort((a, b) => {
    const aTime = new Date(a.createdAt || 0).getTime();
    const bTime = new Date(b.createdAt || 0).getTime();
    return bTime - aTime;
  });
}

function computeStreak(completedSessions) {
  const dates = new Set(completedSessions.map((session) => session.date));
  let streak = 0;
  const cursor = new Date();

  while (true) {
    const key = formatDateKey(cursor);
    if (!dates.has(key)) break;
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }

  return streak;
}

function deriveDifficultyLevel(user) {
  const sessions = sortSessions(user.sessions)
    .map(normalizeSession)
    .filter((session) => session.quizResult && Number.isFinite(session.quizResult.accuracy))
    .slice(0, 5);

  if (!sessions.length) return 2;
  const avg = sessions.reduce((sum, session) => sum + session.quizResult.accuracy, 0) / sessions.length;
  if (avg > 75) return 3;
  if (avg < 40) return 2;
  return 2;
}

function upsertUser(input) {
  const email = normalizeEmail(input?.email);
  if (!email) {
    throw new Error("请先输入接收内容的邮箱。");
  }

  const key = email.toLowerCase();
  const existing = store.users[key];
  const preferences = normalizePreferences({
    ...existing?.preferences,
    ...input,
    email
  });

  const user = existing || { email, preferences, sessions: [], currentLevel: 1, pet: normalizePet({ name: preferences.petName, age: 1 }) };
  user.email = email;
  user.preferences = preferences;
  user.sessions = Array.isArray(user.sessions) ? user.sessions : [];
  user.currentLevel = deriveDifficultyLevel(user);
  user.pet = normalizePet({ ...user.pet, name: preferences.petName });
  store.users[key] = user;

  appendLog(`${email} 更新了学习订阅配置`);
  return user;
}

function getUser(email) {
  const cleanEmail = normalizeEmail(email).toLowerCase();
  return cleanEmail ? store.users[cleanEmail] || null : null;
}

function restoreUserState(payload) {
  const email = normalizeEmail(payload?.email);
  if (!email) {
    return { ok: false, message: "缺少邮箱，无法恢复记录。" };
  }

  const cached = payload && typeof payload === "object" ? payload : {};
  const profile = cached.profile && typeof cached.profile === "object" ? cached.profile : {};
  const history = Array.isArray(cached.history) ? cached.history : [];

  const user = upsertUser({
    email,
    dailyCount: profile.dailyCount,
    learningTypes: profile.learningTypes,
    customTopic: profile.customTopic,
    petName: profile.petName,
    sendTime: profile.sendTime,
    reviewEnabled: profile.reviewEnabled,
    reviewTime: profile.reviewTime,
    backupChannel: profile.backupChannel,
    backupContact: profile.backupContact
  });

  const existing = Array.isArray(user.sessions) ? user.sessions : [];
  const mergedMap = new Map();

  existing.forEach((session) => {
    const normalized = normalizeSession(session);
    const key = normalized.id || `${normalized.date}-${normalized.createdAt}`;
    mergedMap.set(key, normalized);
  });

  history.forEach((session) => {
    const normalized = normalizeSession(session);
    const key = normalized.id || `${normalized.date}-${normalized.createdAt}`;
    const prev = mergedMap.get(key);
    if (!prev) {
      mergedMap.set(key, normalized);
      return;
    }
    const prevTime = new Date(prev.createdAt || 0).getTime();
    const nextTime = new Date(normalized.createdAt || 0).getTime();
    if (nextTime >= prevTime) mergedMap.set(key, normalized);
  });

  user.sessions = sortSessions(Array.from(mergedMap.values())).map(normalizeSession);
  if (cached.pet && typeof cached.pet === "object") {
    user.pet = normalizePet({
      ...user.pet,
      name: cached.pet.name || profile.petName,
      age: Math.max(Number(user?.pet?.age || 1), Number(cached.pet.age || 1))
    });
  } else {
    user.pet = normalizePet({ ...user.pet, name: profile.petName });
  }

  saveStore();
  appendLog(`${email} 从本机缓存恢复了学习记录`);
  return buildClientState(email);
}

async function sendMorningLesson(email, mode) {
  const user = upsertUser({ email });
  const today = formatDateKey(new Date());
  let session = sortSessions(user.sessions).find((item) => item.date === today);

  if (!session) {
    session = await createSession(user, mode, { fastMode: mode === "manual" });
    user.sessions.push(session);
  }

  const normalizedSession = normalizeSession(session);

  try {
    const delivery = await deliverEmail(user.email, {
      subject: `每日学习助手｜${normalizedSession.date} 今日学习内容`,
      html: renderMorningEmail(normalizedSession, user.email),
      text: renderMorningText(normalizedSession, user.email)
    });
    session.delivery = session.delivery || {};
    session.delivery.morning = delivery;
  } catch (error) {
    appendLog(`${user.email} 的晨间邮件发送失败：${error.message}`);
    return { ok: false, message: `晨间内容发送失败：${error.message}`, state: buildClientState(user.email) };
  }

  appendLog(`${user.email} ${mode === "auto" ? "自动" : "手动"}发送了今日学习内容`);
  saveStore();
  return {
    ok: true,
    message: session.delivery.morning?.mode === "preview" ? "已生成今日学习内容，当前为预览模式，尚未真实发信。" : "今日学习内容已发送到邮箱。",
    state: buildClientState(user.email)
  };
}

async function sendEveningReview(email, mode) {
  const user = upsertUser({ email });
  const session = sortSessions(user.sessions)
    .map(normalizeSession)
    .find((item) => item.reviewEligible && !item.quizSentAt);

  if (!session) {
    return {
      ok: false,
      message: "当前没有可发送的晚间复习。英语类内容会在生成当日学习后开放复盘。",
      state: buildClientState(user.email)
    };
  }

  const rawSession = user.sessions.find((item) => item.id === session.id);
  try {
    const delivery = await deliverEmail(user.email, {
      subject: `每日学习助手｜${session.date} 晚间复习测试`,
      html: renderEveningEmail(session, user.email),
      text: renderEveningText(session, user.email)
    });
    rawSession.delivery = rawSession.delivery || {};
    rawSession.delivery.evening = delivery;
    rawSession.quizSentAt = new Date().toISOString();
    rawSession.quizMode = mode;
  } catch (error) {
    appendLog(`${user.email} 的晚间复习发送失败：${error.message}`);
    return { ok: false, message: `晚间复习发送失败：${error.message}`, state: buildClientState(user.email) };
  }

  appendLog(`${user.email} ${mode === "auto" ? "自动" : "手动"}发送了晚间复盘`);
  saveStore();
  return {
    ok: true,
    message: rawSession.delivery.evening?.mode === "preview" ? "已生成晚间复盘内容，当前为预览模式，尚未真实发信。" : "晚间复习测试已发送。",
    state: buildClientState(user.email)
  };
}

function completeSession(payload) {
  const result = completeSessionInternal(payload?.email, payload?.sessionId, "dashboard");
  return {
    ok: result.ok,
    message: result.message,
    state: buildClientState(payload?.email)
  };
}

function completeSessionInternal(email, sessionId, source) {
  const user = getUser(email);
  if (!user) {
    return { ok: false, message: "还没有找到这个邮箱对应的订阅记录。" };
  }

  const session = sessionId
    ? user.sessions.find((item) => item.id === String(sessionId))
    : sortSessions(user.sessions)[0];

  if (!session) {
    return { ok: false, message: "当前没有可以标记完成的学习记录。" };
  }

  if (session.completedAt) {
    return { ok: true, message: "今日学习已完成，无需重复打卡。" };
  }

  session.completedAt = new Date().toISOString();
  session.completionSource = source;
  const completedSessions = user.sessions.filter((item) => item.completedAt).map(normalizeSession);
  const streak = computeStreak(completedSessions);
  const targetPetAge = Math.max(1, 1 + Math.floor(streak / 10));
  user.pet = normalizePet({
    ...user.pet,
    name: user.preferences.petName,
    age: Math.max(Number(user?.pet?.age || 1), targetPetAge)
  });
  appendLog(`${user.email} 完成了 ${session.date} 的学习内容`);
  saveStore();
  return { ok: true, message: "已记录今日完成，连续学习数据已更新。" };
}

function submitQuiz(payload) {
  const email = normalizeEmail(payload?.email);
  const sessionId = String(payload?.sessionId || "");
  const user = getUser(email);

  if (!user) {
    return { ok: false, message: "没有找到该邮箱的学习记录。", state: buildClientState(email) };
  }

  const session = user.sessions.find((item) => item.id === sessionId);
  if (!session) {
    return { ok: false, message: "没有找到对应的测试记录。", state: buildClientState(email) };
  }

  const normalizedSession = normalizeSession(session);
  const answers = Array.isArray(payload?.answers) ? payload.answers : [];
  const questions = normalizedSession.quiz?.questions || [];
  let score = 0;

  const reviewed = questions.map((question, index) => {
    const answer = String(answers[index] || "").trim();
    const isCorrect = compareAnswer(answer, question.answer);
    if (isCorrect) score += 1;
    return {
      questionId: question.id,
      prompt: question.prompt,
      answer,
      correctAnswer: question.answer,
      isCorrect
    };
  });

  session.quizResult = {
    submittedAt: new Date().toISOString(),
    score,
    total: questions.length,
    accuracy: questions.length ? Math.round((score / questions.length) * 100) : 0,
    answers: reviewed
  };

  appendLog(`${user.email} 完成了晚间测试，正确率 ${session.quizResult.accuracy}%`);
  saveStore();
  return {
    ok: true,
    message: `测试已提交，本次正确率 ${session.quizResult.accuracy}%`,
    state: buildClientState(user.email)
  };
}

async function createSession(user, mode, options = {}) {
  const now = new Date();
  const difficultyLevel = deriveDifficultyLevel(user);
  const generated = await buildDailyContent(user.preferences, difficultyLevel, options);
  const items = generated.items;
  const session = {
    id: createId(),
    email: user.email,
    date: formatDateKey(now),
    createdAt: now.toISOString(),
    mode,
    learningTypes: user.preferences.learningTypes,
    customTopic: user.preferences.customTopic,
    difficultyLevel,
    generationMode: generated.generationMode,
    items,
    reviewEligible: hasReviewableItems(items),
    completedAt: null,
    completionSource: null,
    quiz: null,
    quizSentAt: null,
    quizMode: null,
    quizResult: null,
    delivery: { morning: null, evening: null }
  };

  session.quiz = session.reviewEligible ? buildQuizForSession(session) : null;
  return session;
}

async function buildDailyContent(preferences, level, options = {}) {
  const aiGenerated = await generateDailyContentWithArk(preferences, level, options);
  if (aiGenerated.ok) {
    return {
      items: aiGenerated.items.map(normalizeContentItem),
      generationMode: aiGenerated.generationMode
    };
  }

  if (aiGenerated.reason) {
    appendLog(`AI内容生成回退：${aiGenerated.reason}`);
  }

  const types = normalizeLearningTypes(preferences.learningTypes);
  const count = normalizeDailyCount(preferences.dailyCount);
  const items = [];

  for (let index = 0; index < count; index += 1) {
    const type = types[index % types.length];
    if (type === "custom") {
      items.push(buildCustomTopicItem(preferences.customTopic, level, index));
      continue;
    }
    if (type === "finance" || type === "ai_news") {
      items.push(buildNewsFallbackItem(type, index));
      continue;
    }
    items.push(pickCuratedItem(type, level));
  }

  return {
    items: items.map(normalizeContentItem),
    generationMode: "curated-fallback"
  };
}

function buildNewsFallbackItem(type, index) {
  const today = formatDateKey(new Date());
  const isAi = type === "ai_news";
  return normalizeContentItem({
    id: createId(),
    type,
    level: 2,
    headline: isAi ? "今日AI前沿要闻待刷新" : "今日财经要闻待刷新",
    chinese: isAi ? "AI前沿资讯" : "财经资讯",
    summary: `${today} 实时要闻生成暂时超时，请稍后点击“发送今日内容”重试。`,
    takeaway: "为确保资讯时效性，本条不使用历史静态新闻替代。",
    keywords: [today, isAi ? "AI要闻" : "财经要闻", `slot-${index + 1}`],
    source: "news-fallback"
  });
}

async function generateDailyContentWithArk(preferences, level, options = {}) {
  if (!ARK_API_KEY || !ARK_BASE_URL || !ARK_MODEL) {
    return { ok: false, reason: "ark-not-configured" };
  }

  const types = normalizeLearningTypes(preferences.learningTypes);
  const dailyCount = normalizeDailyCount(preferences.dailyCount);
  const customTopic = String(preferences.customTopic || "").trim();
  const targetLevel = Math.max(2, normalizeLevel(level));
  const fastMode = Boolean(options?.fastMode);
  const newsTimeoutMs = fastMode ? 5000 : 12000;
  const arkTimeoutMs = fastMode ? 12000 : ARK_TIMEOUT_MS;
  const newsContext = await fetchNewsContext(types, newsTimeoutMs);

  const systemPrompt = [
    "你是每日学习助手内容引擎。",
    "输出必须是纯 JSON，不要 markdown，不要解释。",
    "JSON schema: {\"items\":[...],\"quiz\":{\"questions\":[...]}}",
    "items 每项字段：type(vocabulary/spoken/finance/ai_news), level(1-3), headline, chinese, phonetic, scene, example, summary, takeaway, keywords(string[])。",
    "quiz.questions 每项字段：id,type(choice/text),prompt,answer,options(仅choice),hint。",
    "地道口语表达和单词记忆必须至少 B2 难度，默认偏 C1，避免入门表达。",
    "财经资讯和AI前沿资讯必须是当日或近24小时的重要要闻概述，且必须体现来源与时间线索。",
    "不要编造新闻来源；如果没有可靠信息，宁可返回“待刷新”占位说明。",
    "严格按用户选择的类型与数量生成，不得漏项。",
    "如果是地道口语表达或单词记忆，优先给出可用于复习的题目；finance/ai_news 可以少出或不出题。"
  ].join("\n");

  const userPrompt = JSON.stringify(
    {
      goal: "生成今日学习内容与复习题",
      today: formatDateKey(new Date()),
      timezone: "Asia/Shanghai",
      learningTypes: types,
      dailyCount,
      level: targetLevel,
      customTopic,
      hardRules: [
        "必须生成与 dailyCount 等量的 items",
        "items.type 仅允许出现在 learningTypes 中",
        "spoken/vocabulary 的 level 不低于2",
        "finance/ai_news 优先使用 newsContext"
      ],
      newsContext
    },
    null,
    0
  );

  const temperatures = fastMode ? [0.35] : [0.35, 0.45];
  let lastError = "";
  for (let i = 0; i < temperatures.length; i += 1) {
    try {
      const raw = await arkChat({
        model: ARK_MODEL,
        systemPrompt,
        userPrompt,
        temperature: temperatures[i],
        timeoutMs: arkTimeoutMs
      });
      const parsed = parseArkJson(raw);
      const normalized = normalizeAiGenerated(parsed, {
        level: targetLevel,
        types,
        dailyCount,
        customTopic,
        newsContext
      });
      if (isQualityAcceptable(normalized.items, { types, dailyCount })) {
        return { ok: true, items: normalized.items, generationMode: "doubao-ark", quiz: normalized.quiz };
      }
      lastError = `quality-check-failed-attempt-${i + 1}`;
    } catch (error) {
      lastError = error.message || `attempt-${i + 1}-failed`;
    }
  }

  appendLog(`AI内容生成失败：${lastError}`);
  return { ok: false, reason: "ark-error" };
}

function isQualityAcceptable(items, context) {
  if (!Array.isArray(items) || items.length < context.dailyCount) return false;
  const allowed = new Set(context.types);
  const subset = items.slice(0, context.dailyCount);
  for (const item of subset) {
    if (!allowed.has(item.type)) return false;
    if ((item.type === "spoken" || item.type === "vocabulary") && Number(item.level || 0) < 2) return false;
    if (!item.headline || String(item.headline).trim().length < 6) return false;
  }
  return true;
}

async function fetchNewsContext(types, timeoutMs = 12000) {
  const needsFinance = types.includes("finance");
  const needsAi = types.includes("ai_news");
  const context = { finance: [], ai_news: [] };

  const tasks = [];
  if (needsFinance) {
    tasks.push(
      fetchRssItems("https://news.google.com/rss/search?q=finance+when:1d&hl=en-US&gl=US&ceid=US:en", 6, timeoutMs)
        .then((items) => { context.finance = items; })
        .catch(() => {})
    );
  }
  if (needsAi) {
    tasks.push(
      fetchRssItems("https://news.google.com/rss/search?q=artificial+intelligence+when:1d&hl=en-US&gl=US&ceid=US:en", 6, timeoutMs)
        .then((items) => { context.ai_news = items; })
        .catch(() => {})
    );
  }
  await Promise.all(tasks);
  return context;
}

async function fetchRssItems(url, limit, timeoutMs = 12000) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(3000, Number(timeoutMs) || 12000));
  try {
    const response = await fetch(url, { signal: controller.signal });
    if (!response.ok) return [];
    const xml = await response.text();
    const matches = Array.from(xml.matchAll(/<item>([\s\S]*?)<\/item>/gi));
    return matches.slice(0, limit).map((m) => {
      const block = m[1] || "";
      return {
        title: xmlValue(block, "title"),
        source: xmlValue(block, "source"),
        pubDate: xmlValue(block, "pubDate"),
        link: xmlValue(block, "link"),
        description: stripHtml(xmlValue(block, "description"))
      };
    }).filter((x) => x.title);
  } catch {
    return [];
  } finally {
    clearTimeout(timeout);
  }
}

function xmlValue(block, tag) {
  const reg = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, "i");
  const match = String(block || "").match(reg);
  if (!match) return "";
  return decodeHtmlEntities(stripCdata(match[1]).trim());
}

function stripCdata(text) {
  return String(text || "").replace(/^<!\[CDATA\[/, "").replace(/\]\]>$/, "");
}

function stripHtml(text) {
  return String(text || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
}

function decodeHtmlEntities(text) {
  return String(text || "")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'");
}

async function checkArkHealth() {
  const configured = Boolean(ARK_API_KEY && ARK_BASE_URL && ARK_MODEL);
  if (!configured) {
    return {
      ok: false,
      configured,
      baseUrl: ARK_BASE_URL,
      model: ARK_MODEL,
      message: "ARK未配置完整"
    };
  }

  try {
    await arkChat({
      model: ARK_MODEL,
      systemPrompt: "你是助手。返回JSON。",
      userPrompt: "{\"ping\":true}"
    });
    return {
      ok: true,
      configured,
      baseUrl: ARK_BASE_URL,
      model: ARK_MODEL,
      message: "ARK调用成功"
    };
  } catch (error) {
    return {
      ok: false,
      configured,
      baseUrl: ARK_BASE_URL,
      model: ARK_MODEL,
      message: error.message
    };
  }
}

async function arkChat({ model, systemPrompt, userPrompt, temperature = 0.45, timeoutMs = ARK_TIMEOUT_MS }) {
  const base = ARK_BASE_URL.replace(/\/(chat\/completions|responses)$/i, "");
  const responsePayload = {
    model,
    temperature,
    input: [
      {
        role: "system",
        content: [{ type: "input_text", text: systemPrompt }]
      },
      {
        role: "user",
        content: [{ type: "input_text", text: userPrompt }]
      }
    ]
  };

  const responsesResult = await arkRequest(`${base}/responses`, responsePayload, timeoutMs);
  if (responsesResult.ok) {
    const responsesData = responsesResult.data;
    const directText = responsesData?.output_text;
    if (directText) return String(directText);

    const nestedText = (responsesData?.output || [])
      .flatMap((part) => part?.content || [])
      .map((item) => item?.text || item?.output_text || "")
      .filter(Boolean)
      .join("\n")
      .trim();
    if (nestedText) return nestedText;
  }

  const chatPayload = {
    model,
    temperature,
    response_format: { type: "json_object" },
    messages: [
      { role: "system", content: systemPrompt },
      { role: "user", content: userPrompt }
    ]
  };
  const chatResult = await arkRequest(`${base}/chat/completions`, chatPayload, timeoutMs);
  if (chatResult.ok) {
    const content = chatResult?.data?.choices?.[0]?.message?.content;
    if (content) return String(content);
  }

  const respErr = responsesResult.error || "responses-empty";
  const chatErr = chatResult.error || "chat-empty";
  throw new Error(`ark-http-failed:responses=${respErr};chat=${chatErr}`);
}

async function arkRequest(url, payload, timeoutMs = ARK_TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(5000, Number(timeoutMs) || ARK_TIMEOUT_MS));
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${ARK_API_KEY}`
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      return {
        ok: false,
        error: data?.error?.message || data?.message || `HTTP ${response.status}`
      };
    }
    return { ok: true, data };
  } catch (error) {
    return { ok: false, error: error.message || "request-failed" };
  } finally {
    clearTimeout(timeout);
  }
}

function parseArkJson(content) {
  const clean = String(content || "").trim();
  const fenced = clean.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const jsonText = fenced ? fenced[1].trim() : clean;
  return JSON.parse(jsonText);
}

function normalizeAiGenerated(parsed, context) {
  const items = Array.isArray(parsed?.items) ? parsed.items : [];
  const quizQuestions = Array.isArray(parsed?.quiz?.questions) ? parsed.quiz.questions : [];
  const resultItems = items
    .slice(0, context.dailyCount)
    .map((item, index) => {
      const type = normalizeItemType(item?.type || context.types[index % context.types.length]);
      const base = {
        id: createId(),
        type,
        level: normalizeLevel(item?.level || context.level),
        headline: String(item?.headline || item?.english || ""),
        chinese: String(item?.chinese || (type === "custom" ? context.customTopic : "")),
        phonetic: String(item?.phonetic || ""),
        scene: String(item?.scene || ""),
        example: String(item?.example || ""),
        summary: String(item?.summary || ""),
        takeaway: String(item?.takeaway || ""),
        keywords: Array.isArray(item?.keywords) ? item.keywords.map((v) => String(v)) : [],
        source: "doubao"
      };
      if ((type === "spoken" || type === "vocabulary") && base.level < 2) {
        base.level = 2;
      }
      if ((type === "finance" || type === "ai_news") && !isLikelyDailyNewsItem(base)) {
        return buildNewsFallbackItem(type, index);
      }
      if (!base.headline) {
        if (type === "custom") {
          return buildCustomTopicItem(context.customTopic, context.level, index);
        }
        if (type === "finance" || type === "ai_news") {
          return buildNewsFallbackItem(type, index);
        }
        return pickCuratedItem(type, context.level);
      }
      return base;
    });

  if (resultItems.length < context.dailyCount) {
    for (let i = resultItems.length; i < context.dailyCount; i += 1) {
      const fallbackType = context.types[i % context.types.length];
      resultItems.push(
        fallbackType === "custom"
          ? buildCustomTopicItem(context.customTopic, context.level, i)
          : (fallbackType === "finance" || fallbackType === "ai_news")
            ? buildNewsFallbackItem(fallbackType, i)
          : pickCuratedItem(fallbackType, context.level)
      );
    }
  }

  const questions = quizQuestions.slice(0, 5).map((q, index) => ({
    id: String(q?.id || createId()),
    type: q?.type === "choice" ? "choice" : "text",
    prompt: String(q?.prompt || ""),
    answer: String(q?.answer || ""),
    options: Array.isArray(q?.options)
      ? [...new Set([String(q?.answer || ""), ...q.options.map((o) => String(o))])].filter(Boolean).slice(0, 4)
      : null,
    hint: String(q?.hint || "")
  })).filter((q) => q.prompt && q.answer);

  return {
    items: resultItems,
    quiz: questions.length ? { questions } : null
  };
}

function isLikelyDailyNewsItem(item) {
  const text = `${item.headline || ""} ${item.summary || ""} ${item.takeaway || ""}`.toLowerCase();
  const hasTodayHint = /今日|today|24小时|latest|刚刚|快讯|breaking/.test(text);
  const hasTimeHint = /\d{4}-\d{1,2}-\d{1,2}|\d{1,2}[:：]\d{2}|月\d{1,2}日/.test(text);
  const hasSourceHint = /路透|彭博|华尔街见闻|新华社|财新|ft|reuters|bloomberg|wsj|techcrunch|the verge|openai|anthropic|google|meta/.test(text);
  return (hasTodayHint || hasTimeHint) && hasSourceHint;
}

function pickCuratedItem(type, level) {
  const fallback = contentPool.filter((item) => item.type === type);
  const preferred = fallback.filter((item) => item.level === level);
  const source = preferred.length ? preferred : fallback.length ? fallback : contentPool;

  store.progress.typeCursor = store.progress.typeCursor || {};
  const cursor = Number(store.progress.typeCursor[type] || 0);
  const item = source[cursor % source.length];
  store.progress.typeCursor[type] = (cursor + 1) % source.length;

  return { ...item, source: "database" };
}

function buildCustomTopicItem(topic, level, index) {
  const safeTopic = String(topic || "用户自定义主题").trim() || "用户自定义主题";
  const patterns = [
    {
      headline: `${safeTopic} 今日焦点`,
      summary: `用 90 秒理解 ${safeTopic} 中最值得今天吸收的一个关键概念。`,
      takeaway: `请把 ${safeTopic} 拆成“定义、影响、行动建议”三步理解。`
    },
    {
      headline: `${safeTopic} 快速拆解`,
      summary: `今天的学习内容围绕 ${safeTopic} 的核心变化与实际场景展开。`,
      takeaway: `读完后用一句话复述 ${safeTopic} 为什么重要。`
    },
    {
      headline: `${safeTopic} 应用卡片`,
      summary: `从真实使用场景切入，整理 ${safeTopic} 的关键认知和常见误区。`,
      takeaway: `尝试把 ${safeTopic} 和你最近的工作、学习任务建立联系。`
    }
  ];

  const pattern = patterns[index % patterns.length];
  return normalizeContentItem({
    id: createId(),
    type: "custom",
    level,
    headline: pattern.headline,
    chinese: safeTopic,
    summary: pattern.summary,
    takeaway: pattern.takeaway,
    keywords: [safeTopic, `Level ${level}`],
    source: "template-generator"
  });
}

function buildQuizForSession(session) {
  const reviewItems = session.items.filter((item) => TYPE_META[item.type]?.reviewEligible).slice(0, 5);
  return {
    questions: reviewItems.map((item, index) => buildChoiceQuestion(session.id, item, index))
  };
}

function buildChoiceQuestion(sessionId, item, index) {
  const variant = index % 3;
  const id = `${sessionId}-${index + 1}`;

  if (item.type === "spoken") {
    const spokenPool = contentPool.filter((entry) => entry.type === "spoken");
    const chineseDistractors = shuffle(
      spokenPool
        .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
        .map((entry) => entry.chinese)
    ).slice(0, 3);
    const englishDistractors = shuffle(
      spokenPool
        .filter((entry) => normalizeLoose(entry.headline) !== normalizeLoose(item.headline))
        .map((entry) => entry.headline)
    ).slice(0, 3);

    if (variant === 0) {
      return {
        id,
        type: "choice",
        prompt: `这句口语更贴近哪种中文含义？${item.headline}`,
        answer: item.chinese,
        options: shuffle([item.chinese, ...chineseDistractors]),
        hint: item.scene || ""
      };
    }

    if (variant === 1) {
      return {
        id,
        type: "choice",
        prompt: `这句表达的正确中文翻译是？${item.headline}`,
        answer: item.chinese,
        options: shuffle([item.chinese, ...chineseDistractors]),
        hint: item.scene || ""
      };
    }

    return {
      id,
      type: "choice",
      prompt: `根据中文选择更自然的英文表达：${item.chinese}`,
      answer: item.headline,
      options: shuffle([item.headline, ...englishDistractors]),
      hint: item.scene || ""
    };
  }

  const vocabularyPool = contentPool.filter((entry) => entry.type === "vocabulary");
  const chineseDistractors = shuffle(
    vocabularyPool
      .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
      .map((entry) => entry.chinese)
  ).slice(0, 3);
  const englishDistractors = shuffle(
    vocabularyPool
      .filter((entry) => normalizeLoose(entry.headline) !== normalizeLoose(item.headline))
      .map((entry) => entry.headline)
  ).slice(0, 3);

  if (variant === 0) {
    return {
      id,
      type: "choice",
      prompt: `“${item.headline}” 的中文意思是什么？`,
      answer: item.chinese,
      options: shuffle([item.chinese, ...chineseDistractors]),
      hint: item.phonetic || ""
    };
  }

  if (variant === 1) {
    return {
      id,
      type: "choice",
      prompt: `根据中文选择正确单词：${item.chinese}`,
      answer: item.headline,
      options: shuffle([item.headline, ...englishDistractors]),
      hint: item.phonetic || ""
    };
  }

  return {
    id,
    type: "choice",
    prompt: `补全例句中的单词：${(item.example || "").replace(new RegExp(escapeRegExp(item.headline), "i"), "_____")}`,
    answer: item.headline,
    options: shuffle([item.headline, ...englishDistractors]),
    hint: item.chinese || ""
  };
}

function buildQuestion(sessionId, item, index) {
  const variant = index % 3;
  const id = `${sessionId}-${index + 1}`;

  if (item.type === "spoken") {
    const spokenPool = contentPool.filter((entry) => entry.type === "spoken");
    const distractors = shuffle(
      spokenPool
        .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
        .map((entry) => entry.chinese)
    ).slice(0, 3);

    if (variant === 0) {
      return {
        id,
        type: "choice",
        prompt: `这句口语更贴近哪一种中文含义？${item.headline}`,
        answer: item.chinese,
        options: shuffle([item.chinese, ...distractors]),
        hint: item.scene || ""
      };
    }

    if (variant === 1) {
      return {
        id,
        type: "text",
        prompt: `把这句表达翻译成中文：${item.headline}`,
        answer: item.chinese,
        hint: item.scene || ""
      };
    }

    return {
      id,
      type: "text",
      prompt: `根据中文写出更自然的英文表达：${item.chinese}`,
      answer: item.headline,
      hint: item.scene || ""
    };
  }

  const vocabularyPool = contentPool.filter((entry) => entry.type === "vocabulary");
  const distractors = shuffle(
    vocabularyPool
      .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
      .map((entry) => entry.chinese)
  ).slice(0, 3);

  if (variant === 0) {
    return {
      id,
      type: "choice",
      prompt: `“${item.headline}” 的中文意思是什么？`,
      answer: item.chinese,
      options: shuffle([item.chinese, ...distractors]),
      hint: item.phonetic || ""
    };
  }

  if (variant === 1) {
    return {
      id,
      type: "text",
      prompt: `根据中文写出单词：${item.chinese}`,
      answer: item.headline,
      hint: item.phonetic || ""
    };
  }

  return {
    id,
    type: "text",
    prompt: `补全例句中的单词：${(item.example || "").replace(new RegExp(escapeRegExp(item.headline), "i"), "_____")}`,
    answer: item.headline,
    hint: item.chinese || ""
  };
}

function compareAnswer(input, answer) {
  return normalizeLoose(input) === normalizeLoose(answer);
}

function hasReviewableItems(items) {
  return items.some((item) => TYPE_META[normalizeItemType(item.type)]?.reviewEligible);
}

function runSchedulerCheck() {
  const now = new Date();
  const minuteKey = `${formatDateKey(now)} ${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
  if (schedulerMinuteKey === minuteKey) return;
  schedulerMinuteKey = minuteKey;
  const currentTime = minuteKey.slice(-5);

  Object.values(store.users).forEach((user) => {
    if (user.preferences.sendTime === currentTime) {
      sendMorningLesson(user.email, "auto").catch((error) => appendLog(`${user.email} 的自动晨间推送失败：${error.message}`));
    }
    if (user.preferences.reviewEnabled && user.preferences.reviewTime === currentTime) {
      sendEveningReview(user.email, "auto").catch((error) => appendLog(`${user.email} 的自动晚间复盘失败：${error.message}`));
    }
  });
}

async function deliverEmail(to, mail) {
  const smtp = getSmtpConfig();
  if (!to) {
    throw new Error("缺少接收邮箱。");
  }

  if (!smtp.enabled || !smtp.host || !smtp.user || !smtp.pass || !smtp.from) {
    return {
      id: createId(),
      sentAt: new Date().toISOString(),
      subject: mail.subject,
      opens: 0,
      clicks: 0,
      openedAt: null,
      clickedAt: null,
      mode: "preview"
    };
  }

  await smtpSend({
    host: smtp.host,
    port: Number(smtp.port || 465),
    secure: smtp.secure !== false,
    user: smtp.user,
    pass: smtp.pass,
    from: smtp.from,
    to,
    subject: mail.subject,
    html: mail.html,
    text: mail.text
  });

  return {
    id: createId(),
    sentAt: new Date().toISOString(),
    subject: mail.subject,
    opens: 0,
    clicks: 0,
    openedAt: null,
    clickedAt: null,
    mode: "smtp"
  };
}

function getSmtpConfig() {
  return {
    enabled: process.env.SMTP_ENABLED ? process.env.SMTP_ENABLED === "true" : Boolean(store.smtp.enabled),
    host: process.env.SMTP_HOST || store.smtp.host,
    port: Number(process.env.SMTP_PORT || store.smtp.port || 465),
    secure: process.env.SMTP_SECURE ? process.env.SMTP_SECURE === "true" : store.smtp.secure !== false,
    user: process.env.SMTP_USER || store.smtp.user,
    pass: process.env.SMTP_PASS || store.smtp.pass,
    from: process.env.SMTP_FROM || store.smtp.from
  };
}

function smtpSend(options) {
  return new Promise((resolve, reject) => {
    const timeoutMs = Number(process.env.SMTP_TIMEOUT_MS || 15000);
    let finished = false;
    const socket = options.secure
      ? tls.connect(options.port, options.host, { servername: options.host, rejectUnauthorized: false }, onConnected)
      : net.connect(options.port, options.host, onConnected);

    function fail(error) {
      if (finished) return;
      finished = true;
      try {
        socket.destroy();
      } catch {}
      reject(error);
    }

    function succeed() {
      if (finished) return;
      finished = true;
      try {
        socket.end();
      } catch {}
      resolve();
    }

    socket.setEncoding("utf8");
    socket.setTimeout(timeoutMs, () => fail(new Error(`SMTP 连接超时（${timeoutMs}ms）`)));
    socket.on("error", (error) => fail(error));

    let buffer = "";
    let waiting = null;
    socket.on("data", (chunk) => {
      if (finished) return;
      buffer += chunk;
      if (!buffer.includes("\r\n")) return;
      const lines = buffer.split("\r\n");
      buffer = lines.pop();
      for (const line of lines) {
        if (!line) continue;
        if (waiting && /^[0-9]{3} /.test(line)) {
          const done = waiting;
          waiting = null;
          done(line);
        }
      }
    });

    function onConnected() {
      run().catch((error) => fail(error));
    }

    function send(command) {
      socket.write(`${command}\r\n`);
    }

    function waitCode(prefix) {
      return new Promise((resolveLine, rejectLine) => {
        waiting = (line) => {
          if (!line.startsWith(prefix)) {
            rejectLine(new Error(`SMTP 响应异常：${line}`));
            return;
          }
          resolveLine(line);
        };
      });
    }

    async function run() {
      await waitCode("220");
      send("EHLO localhost");
      await waitCode("250");
      send("AUTH LOGIN");
      await waitCode("334");
      send(Buffer.from(options.user).toString("base64"));
      await waitCode("334");
      send(Buffer.from(options.pass).toString("base64"));
      await waitCode("235");
      send(`MAIL FROM:<${options.from}>`);
      await waitCode("250");
      send(`RCPT TO:<${options.to}>`);
      await waitCode("250");
      send("DATA");
      await waitCode("354");
      socket.write(`${buildMimeMessage(options)}\r\n.\r\n`);
      await waitCode("250");
      send("QUIT");
      succeed();
    }
  });
}

function buildMimeMessage(options) {
  const boundary = `BOUNDARY_${Date.now()}`;
  const encodedSubject = `=?UTF-8?B?${Buffer.from(options.subject).toString("base64")}?=`;
  return [
    `From: ${options.from}`,
    `To: ${options.to}`,
    `Subject: ${encodedSubject}`,
    "MIME-Version: 1.0",
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    "",
    `--${boundary}`,
    "Content-Type: text/plain; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.text).toString("base64"),
    `--${boundary}`,
    "Content-Type: text/html; charset=UTF-8",
    "Content-Transfer-Encoding: base64",
    "",
    Buffer.from(options.html).toString("base64"),
    `--${boundary}--`
  ].join("\r\n");
}

function renderMorningEmail(session, email) {
  const baseUrl = getBaseUrl();
  const completeUrl = buildTrackedLink(baseUrl, {
    email,
    sessionId: session.id,
    slot: "morning",
    action: "complete",
    redirect: `/today?email=${encodeURIComponent(email)}`
  });
  const pixelUrl = `${baseUrl}/api/email-open?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(session.id)}&slot=morning`;

  const itemsHtml = session.items
    .map(
      (item, index) => `
        <div style="margin-bottom:16px;padding:16px;border-radius:20px;background:#ffffff;border:3px solid ${TYPE_META[item.type]?.accent || "#FF3AF2"};">
          <div style="font-weight:800;font-size:18px;margin-bottom:8px;">${index + 1}. ${escapeHtml(item.headline)}</div>
          <div style="font-size:13px;font-weight:700;color:#6b21a8;margin-bottom:8px;">${escapeHtml(labelForType(item.type))}</div>
          <div style="color:#111827;line-height:1.7;">${escapeHtml(itemToEmailSummary(item))}</div>
        </div>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.7;background:#0D0D1A;color:#ffffff;padding:24px;">
      <div style="max-width:720px;margin:0 auto;background:#1d1038;border:4px solid #FFE600;border-radius:28px;padding:28px;box-shadow:12px 12px 0 #00F5D4;">
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#00F5D4;">Daily Learning Assistant</div>
        <h1 style="margin:10px 0 8px;font-size:32px;line-height:1.1;">今天的学习内容到了</h1>
        <p style="margin:0 0 20px;color:#ddd6fe;">今天共生成 ${session.items.length} 条内容，难度等级 Level ${session.difficultyLevel}。</p>
        ${itemsHtml}
        <div style="margin-top:24px;">
          <a href="${completeUrl}" style="display:inline-block;margin-right:12px;padding:14px 20px;background:linear-gradient(90deg,#FF3AF2,#7B2FFF,#00F5D4);border:4px solid #FFE600;border-radius:999px;color:#ffffff;font-weight:800;text-decoration:none;">完成今日学习</a>
        </div>
        <p style="margin:20px 0 0;color:#c4b5fd;">${session.reviewEligible ? "如果你开启了晚间复盘，系统会在设定时间发送测试。" : "本次内容不包含英语复盘，适合做轻量输入学习。"}</p>
      </div>
      <img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">
    </div>
  `;
}

function renderMorningText(session, email) {
  return [
    `今日学习内容已生成，共 ${session.items.length} 条，难度 Level ${session.difficultyLevel}。`,
    ...session.items.map((item, index) => `${index + 1}. [${labelForType(item.type)}] ${itemToTextSummary(item)}`),
    "",
    `打开学习面板：${getBaseUrl()}/today?email=${encodeURIComponent(email)}`
  ].join("\n");
}

function renderEveningEmail(session, email) {
  const baseUrl = getBaseUrl();
  const quizUrl = buildTrackedLink(baseUrl, {
    email,
    sessionId: session.id,
    slot: "evening",
    action: "quiz",
    redirect: `/today?email=${encodeURIComponent(email)}&panel=review`
  });
  const pixelUrl = `${baseUrl}/api/email-open?email=${encodeURIComponent(email)}&sessionId=${encodeURIComponent(session.id)}&slot=evening`;
  const reviewHtml = session.items
    .filter((item) => TYPE_META[item.type]?.reviewEligible)
    .map(
      (item, index) => `
        <li style="margin-bottom:14px;padding:14px;border-radius:18px;background:#ffffff;color:#111827;">
          <strong>${index + 1}. ${escapeHtml(item.headline)}</strong><br>
          ${escapeHtml(item.chinese || item.summary || "")}
        </li>
      `
    )
    .join("");

  return `
    <div style="font-family:Arial,sans-serif;line-height:1.7;background:#0D0D1A;color:#ffffff;padding:24px;">
      <div style="max-width:720px;margin:0 auto;background:#1d1038;border:4px solid #00F5D4;border-radius:28px;padding:28px;box-shadow:12px 12px 0 #FF3AF2;">
        <div style="font-size:12px;font-weight:700;letter-spacing:2px;text-transform:uppercase;color:#FFE600;">Evening Review</div>
        <h1 style="margin:10px 0 8px;font-size:32px;line-height:1.1;">晚间复盘时间到</h1>
        <p style="margin:0 0 20px;color:#ddd6fe;">先快速过一遍今天的英语内容，再回到网页提交测试。</p>
        <ol style="padding-left:18px;">${reviewHtml}</ol>
        <a href="${quizUrl}" style="display:inline-block;margin-top:20px;padding:14px 20px;background:linear-gradient(90deg,#00F5D4,#7B2FFF,#FF3AF2);border:4px solid #FFE600;border-radius:999px;color:#ffffff;font-weight:800;text-decoration:none;">开始晚间测试</a>
      </div>
      <img src="${pixelUrl}" alt="" width="1" height="1" style="display:block;border:0;opacity:0;">
    </div>
  `;
}

function renderEveningText(session, email) {
  return [
    "晚间复盘已生成，请回到网页完成测试。",
    ...session.items
      .filter((item) => TYPE_META[item.type]?.reviewEligible)
      .map((item, index) => `${index + 1}. ${item.headline} | ${item.chinese || item.summary || ""}`),
    "",
    `测试入口：${getBaseUrl()}/today?email=${encodeURIComponent(email)}&panel=review`
  ].join("\n");
}

function buildTrackedLink(baseUrl, payload) {
  return `${baseUrl}/api/email-click?email=${encodeURIComponent(payload.email)}&sessionId=${encodeURIComponent(payload.sessionId)}&slot=${encodeURIComponent(payload.slot)}&action=${encodeURIComponent(payload.action)}&redirect=${encodeURIComponent(payload.redirect)}`;
}

function markDeliveryOpen(email, sessionId, slot) {
  const session = findSession(email, sessionId);
  const delivery = session?.delivery?.[slot];
  if (!delivery) return;

  delivery.opens = Number(delivery.opens || 0) + 1;
  delivery.openedAt = delivery.openedAt || new Date().toISOString();
  saveStore();
}

function markDeliveryClick(email, sessionId, slot) {
  const session = findSession(email, sessionId);
  const delivery = session?.delivery?.[slot];
  if (!delivery) return;

  delivery.clicks = Number(delivery.clicks || 0) + 1;
  delivery.clickedAt = new Date().toISOString();
  saveStore();
}

function findSession(email, sessionId) {
  const user = getUser(email);
  if (!user) return null;
  return user.sessions.find((session) => session.id === String(sessionId)) || null;
}

function getBaseUrl() {
  return process.env.PUBLIC_BASE_URL || `http://localhost:${PORT}`;
}

function normalizeStore(rawStore) {
  const nextStore = rawStore && typeof rawStore === "object" ? rawStore : seedStore();
  nextStore.smtp = nextStore.smtp || seedStore().smtp;
  nextStore.logs = Array.isArray(nextStore.logs) ? nextStore.logs : [];
  nextStore.progress = nextStore.progress || {};
  nextStore.progress.typeCursor = nextStore.progress.typeCursor || {};
  nextStore.users = nextStore.users || {};

  Object.entries(nextStore.users).forEach(([key, user]) => {
    const email = normalizeEmail(user?.email || key);
    nextStore.users[key] = {
      email,
      preferences: normalizePreferences({ ...user?.preferences, email }),
      sessions: Array.isArray(user?.sessions) ? user.sessions : [],
      currentLevel: Number(user?.currentLevel || 1),
      pet: normalizePet({ ...user?.pet, name: user?.pet?.name || user?.preferences?.petName })
    };
  });

  return nextStore;
}

function normalizePreferences(input) {
  const learningTypes = normalizeLearningTypes(input?.learningTypes ?? input?.contentType);
  const reviewEnabled = input?.reviewEnabled !== undefined
    ? Boolean(input.reviewEnabled)
    : hasEnglishTypes(learningTypes) || Boolean(input?.reviewTime || input?.eveningTime);

  return {
    dailyCount: normalizeDailyCount(input?.dailyCount ?? input?.lessonCount),
    learningTypes,
    customTopic: String(input?.customTopic || "").trim(),
    petName: normalizePetName(input?.petName),
    sendTime: validTime(String(input?.sendTime || input?.morningTime || "")) || "07:30",
    reviewEnabled,
    reviewTime: validTime(String(input?.reviewTime || input?.eveningTime || "")) || "20:30",
    backupChannel: normalizeBackupChannel(input?.backupChannel),
    backupContact: String(input?.backupContact || "").trim()
  };
}

function normalizePet(input) {
  return {
    name: normalizePetName(input?.name),
    age: Math.max(1, Number(input?.age || 1))
  };
}

function normalizeContentPool(items) {
  return (Array.isArray(items) ? items : seedContent()).map(normalizeContentItem);
}

function normalizeContentItem(item) {
  const type = normalizeItemType(item?.type);
  return {
    id: String(item?.id || createId()),
    type,
    level: normalizeLevel(item?.level),
    headline: String(item?.headline || item?.english || item?.title || ""),
    chinese: String(item?.chinese || ""),
    phonetic: String(item?.phonetic || ""),
    scene: String(item?.scene || ""),
    example: String(item?.example || ""),
    summary: String(item?.summary || ""),
    takeaway: String(item?.takeaway || ""),
    keywords: Array.isArray(item?.keywords) ? item.keywords.map((value) => String(value)) : [],
    source: String(item?.source || "database")
  };
}

function normalizeSession(session) {
  const learningTypes = normalizeLearningTypes(session?.learningTypes ?? session?.contentType);
  const items = (Array.isArray(session?.items) ? session.items : []).map(normalizeContentItem);
  const quiz = session?.quiz?.questions
    ? {
        questions: session.quiz.questions.map((question) => ({
          id: String(question.id || createId()),
          type: question.type || (Array.isArray(question.options) ? "choice" : "text"),
          prompt: String(question.prompt || ""),
          answer: String(question.answer || ""),
          options: Array.isArray(question.options) ? question.options.map((option) => String(option)) : null,
          hint: String(question.hint || "")
        }))
      }
    : null;

  return {
    id: String(session?.id || createId()),
    date: String(session?.date || formatDateKey(new Date())),
    createdAt: String(session?.createdAt || new Date().toISOString()),
    mode: session?.mode === "auto" ? "auto" : "manual",
    learningTypes,
    customTopic: String(session?.customTopic || ""),
    difficultyLevel: normalizeLevel(session?.difficultyLevel),
    generationMode: String(session?.generationMode || "curated-fallback"),
    items,
    reviewEligible: session?.reviewEligible !== undefined ? Boolean(session.reviewEligible) : hasReviewableItems(items),
    completedAt: session?.completedAt || null,
    completionSource: session?.completionSource || null,
    quiz,
    quizSentAt: session?.quizSentAt || null,
    quizMode: session?.quizMode || null,
    quizResult: session?.quizResult
      ? {
          submittedAt: session.quizResult.submittedAt || null,
          score: Number(session.quizResult.score || 0),
          total: Number(session.quizResult.total || 0),
          accuracy: Number(session.quizResult.accuracy || 0),
          answers: Array.isArray(session.quizResult.answers) ? session.quizResult.answers : []
        }
      : null,
    delivery: {
      morning: normalizeDelivery(session?.delivery?.morning),
      evening: normalizeDelivery(session?.delivery?.evening)
    }
  };
}

function normalizeDelivery(delivery) {
  if (!delivery) return null;
  return {
    id: String(delivery.id || createId()),
    sentAt: delivery.sentAt || delivery.createdAt || null,
    subject: String(delivery.subject || ""),
    opens: Number(delivery.opens || 0),
    clicks: Number(delivery.clicks || 0),
    openedAt: delivery.openedAt || null,
    clickedAt: delivery.clickedAt || null,
    mode: String(delivery.mode || "smtp")
  };
}

function seedStore() {
  return {
    smtp: {
      enabled: false,
      host: "smtp.qq.com",
      port: 465,
      secure: true,
      user: "",
      pass: "",
      from: ""
    },
    logs: [],
    progress: { typeCursor: {} },
    users: {}
  };
}

function seedContent() {
  return [
    { id: "voc-1", type: "vocabulary", level: 1, headline: "sustainable", phonetic: "/səˈsteɪnəbəl/", chinese: "可持续的", example: "We need a more sustainable study routine.", takeaway: "常用于环保、商业和长期策略语境。" },
    { id: "voc-2", type: "vocabulary", level: 1, headline: "accurate", phonetic: "/ˈækjərət/", chinese: "准确的", example: "The summary is short but accurate.", takeaway: "描述信息、数据和判断是否精确。" },
    { id: "voc-3", type: "vocabulary", level: 2, headline: "resilient", phonetic: "/rɪˈzɪliənt/", chinese: "有韧性的", example: "A resilient learner can recover quickly after setbacks.", takeaway: "既可形容人，也可形容组织和系统。" },
    { id: "voc-4", type: "vocabulary", level: 2, headline: "allocate", phonetic: "/ˈæləkeɪt/", chinese: "分配", example: "You should allocate one hour each day for review.", takeaway: "高频出现在时间、预算和资源管理场景。" },
    { id: "voc-5", type: "vocabulary", level: 3, headline: "compelling", phonetic: "/kəmˈpelɪŋ/", chinese: "令人信服的", example: "Her presentation made a compelling case for the new plan.", takeaway: "常见于表达观点、提案、故事是否有说服力。" },
    { id: "spoken-1", type: "spoken", level: 1, headline: "That makes sense.", chinese: "这就说得通了。", scene: "理解对方解释后的回应", example: "You left early because of the traffic. That makes sense." },
    { id: "spoken-2", type: "spoken", level: 1, headline: "I'm still figuring it out.", chinese: "我还在摸索中。", scene: "计划尚未完全明确时", example: "I haven't chosen a final topic yet. I'm still figuring it out." },
    { id: "spoken-3", type: "spoken", level: 2, headline: "Let's walk through it together.", chinese: "我们一起过一遍吧。", scene: "协作讲解或对齐步骤时", example: "The workflow is a bit dense, so let's walk through it together." },
    { id: "spoken-4", type: "spoken", level: 2, headline: "Can we revisit this tomorrow?", chinese: "我们明天再回头看这个可以吗？", scene: "需要延后讨论时", example: "I'm out of time today. Can we revisit this tomorrow?" },
    { id: "spoken-5", type: "spoken", level: 3, headline: "I'd frame it a little differently.", chinese: "我会稍微换个角度来表述。", scene: "会议中提出更成熟的表达方式", example: "The point is valid, but I'd frame it a little differently." },
    { id: "finance-1", type: "finance", level: 1, headline: "Tech shares lead another broad market rebound", chinese: "科技股带动市场继续反弹", summary: "投资者重新押注高增长板块，风险偏好在短期内回升。", takeaway: "观察市场情绪时，可以先看科技龙头和成交量的同步变化。", keywords: ["市场情绪", "科技股"] },
    { id: "finance-2", type: "finance", level: 1, headline: "Oil prices cool as traders reassess demand outlook", chinese: "交易员重新评估需求前景，油价回落", summary: "能源价格波动往往会传导到运输、制造与通胀预期。", takeaway: "阅读财经新闻时，先抓住“价格变化 + 原因 + 影响对象”三件事。", keywords: ["大宗商品", "通胀"] },
    { id: "finance-3", type: "finance", level: 2, headline: "Central bank signals patience on the next policy move", chinese: "央行释放观望信号，下一步政策动作更趋谨慎", summary: "利率路径不确定时，市场会更关注措辞、就业和通胀数据。", takeaway: "遇到政策类报道，重点看“是否超预期”和“未来路径”。", keywords: ["利率", "宏观政策"] },
    { id: "finance-4", type: "finance", level: 2, headline: "Consumer spending stays firm despite softer confidence", chinese: "消费者信心走弱，但消费支出仍有韧性", summary: "情绪指标与真实支出并不总是同步，零售数据更能体现短期韧性。", takeaway: "看经济新闻时，区分“情绪调查”和“真实数据”很重要。", keywords: ["消费", "零售"] },
    { id: "finance-5", type: "finance", level: 3, headline: "Earnings guidance, not headline profit, drives stock reactions", chinese: "真正驱动股价反应的，常常不是利润本身，而是业绩指引", summary: "财报解读需要同时关注营收、利润率和管理层对未来季度的预期。", takeaway: "高阶阅读财经新闻时，要训练自己从“结果”转向“预期差”。", keywords: ["财报", "预期差"] },
    { id: "ai-1", type: "ai_news", level: 1, headline: "A new open-source reasoning model reaches strong benchmark gains", chinese: "新开源推理模型在多项基准取得明显提升", summary: "团队通过数据清洗和训练策略优化，提升了长链推理与工具调用稳定性。", takeaway: "关注模型更新时，优先看“能力提升点 + 成本变化 + 可落地场景”。", keywords: ["开源模型", "推理能力"] },
    { id: "ai-2", type: "ai_news", level: 1, headline: "AI coding assistants add deeper repository-level context", chinese: "AI 编程助手开始支持更深的仓库级上下文理解", summary: "新能力可基于项目结构、历史改动和依赖关系给出更完整的修改建议。", takeaway: "评估效率工具时，重点比较“上下文理解深度”和“改动可控性”。", keywords: ["AI编程", "工程效率"] },
    { id: "ai-3", type: "ai_news", level: 2, headline: "Multimodal agents move from demo to workflow automation", chinese: "多模态智能体从演示阶段走向工作流自动化", summary: "企业开始把图像、文本和表格任务串成端到端流程，并加入审核机制。", takeaway: "落地智能体项目时，要先设计人机协同和异常回退机制。", keywords: ["智能体", "自动化"] },
    { id: "ai-4", type: "ai_news", level: 2, headline: "Inference optimization cuts serving latency for medium models", chinese: "推理优化方案降低中等规模模型在线延迟", summary: "通过 KV 缓存管理和批处理策略，服务端响应速度和成本得到平衡。", takeaway: "AI 系统优化常是“性能、成本、质量”三角权衡。", keywords: ["推理优化", "延迟"] },
    { id: "ai-5", type: "ai_news", level: 3, headline: "Regulators publish draft principles for high-risk AI applications", chinese: "监管机构发布高风险 AI 应用治理原则草案", summary: "草案强调透明度、可追溯性与人工复核责任，对企业合规提出新要求。", takeaway: "做 AI 产品时，应提前把合规与审计能力纳入架构设计。", keywords: ["AI治理", "合规"] }
  ];
}

function itemToEmailSummary(item) {
  if (item.type === "vocabulary") {
    return `${item.headline}${item.phonetic ? ` ${item.phonetic}` : ""}｜${item.chinese}｜例句：${item.example}`;
  }
  if (item.type === "spoken") {
    return `${item.chinese}｜场景：${item.scene}｜例句：${item.example}`;
  }
  if (item.type === "finance") {
    return `${item.chinese}｜摘要：${item.summary}｜启发：${item.takeaway}`;
  }
  if (item.type === "ai_news") {
    return `${item.chinese}｜要点：${item.summary}｜启发：${item.takeaway}`;
  }
  return `${item.summary}｜启发：${item.takeaway}`;
}

function itemToTextSummary(item) {
  if (item.type === "vocabulary") {
    return `${item.headline} ${item.phonetic || ""} | ${item.chinese} | ${item.example}`;
  }
  if (item.type === "spoken") {
    return `${item.headline} | ${item.chinese} | ${item.scene}`;
  }
  if (item.type === "finance") {
    return `${item.headline} | ${item.chinese} | ${item.summary}`;
  }
  if (item.type === "ai_news") {
    return `${item.headline} | ${item.chinese} | ${item.summary}`;
  }
  return `${item.headline} | ${item.summary}`;
}

function labelForType(type) {
  return TYPE_META[normalizeItemType(type)]?.label || "综合学习";
}

function labelsForTypes(types) {
  return normalizeLearningTypes(types).map((type) => labelForType(type)).join(" / ");
}

function normalizeEmail(value) {
  return String(value || "").trim();
}

function normalizePetName(value) {
  const clean = String(value || "").trim();
  if (!clean) return "小闪电";
  return clean.slice(0, 20);
}

function normalizeDailyCount(value) {
  const count = Number(value || 5);
  if (Number.isNaN(count)) return 5;
  return Math.max(5, Math.min(10, count));
}

function normalizeLearningTypes(value) {
  const raw = Array.isArray(value)
    ? value
    : typeof value === "string"
      ? value.split(",")
      : [];

  const mapped = raw.flatMap((entry) => {
    const clean = String(entry || "").trim();
    if (!clean) return [];
    if (clean === "all") return ["spoken", "vocabulary", "finance", "ai_news"];
    const mappedType = LEGACY_TYPE_MAP[clean];
    return mappedType ? [mappedType] : [];
  });

  const unique = [...new Set(mapped)];
  return unique.length ? unique : ["spoken"];
}

function normalizeItemType(type) {
  return LEGACY_TYPE_MAP[String(type || "").trim()] || "custom";
}

function normalizeLevel(value) {
  const level = Number(value || 1);
  if (Number.isNaN(level)) return 1;
  return Math.max(1, Math.min(3, level));
}

function normalizeBackupChannel(value) {
  const allowed = ["wechat", "telegram", "feishu", "other"];
  const clean = String(value || "").trim().toLowerCase();
  return allowed.includes(clean) ? clean : "wechat";
}

function hasEnglishTypes(types) {
  return normalizeLearningTypes(types).some((type) => TYPE_META[type]?.reviewEligible);
}

function validTime(value) {
  return /^\d{2}:\d{2}$/.test(value) ? value : "";
}

function sanitizeRedirect(value, email) {
  const fallback = email ? `/today?email=${encodeURIComponent(email)}` : "/";
  if (!value) return fallback;
  const clean = String(value);
  if (!clean.startsWith("/")) return fallback;
  return clean;
}

function respondEmailCompletePage(res) {
  const html = `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>今日学习已完成</title>
  <style>
    :root { color-scheme: light; }
    * { box-sizing: border-box; }
    body {
      margin: 0;
      min-height: 100vh;
      display: grid;
      place-items: center;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Microsoft YaHei", sans-serif;
      background: #f5fff7;
      color: #111827;
      padding: 24px;
    }
    .card {
      width: min(560px, 100%);
      background: #ffffff;
      border: 1px solid #d1fae5;
      border-radius: 16px;
      padding: 28px 24px;
      text-align: center;
      box-shadow: 0 8px 30px rgba(16, 185, 129, 0.12);
    }
    .check {
      width: 72px;
      height: 72px;
      margin: 0 auto 16px;
      border-radius: 999px;
      background: #22c55e;
      color: #ffffff;
      display: grid;
      place-items: center;
      font-size: 40px;
      line-height: 1;
      font-weight: 700;
    }
    h1 {
      margin: 0 0 10px;
      font-size: 26px;
    }
    p {
      margin: 0;
      line-height: 1.7;
      color: #374151;
    }
  </style>
</head>
<body>
  <main class="card">
    <div class="check" aria-hidden="true">✓</div>
    <h1>今日学习已完成</h1>
    <p>系统已为你记录本次完成状态，你可以直接关闭此页面。</p>
  </main>
</body>
</html>`;
  res.writeHead(200, { "Content-Type": "text/html; charset=utf-8", "Cache-Control": "no-store, max-age=0" });
  res.end(html);
}

function safeDecode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return "/";
  }
}

function normalizeLoose(value) {
  return String(value || "")
    .toLowerCase()
    .trim()
    .replace(/[.,!?;:'"“”‘’()\-\s]/g, "");
}

function appendLog(message) {
  store.logs.push({
    id: createId(),
    time: new Date().toISOString(),
    message: String(message)
  });
  store.logs = store.logs.slice(-120);
}

function saveStore() {
  fs.writeFileSync(STORE_PATH, JSON.stringify(store, null, 2), "utf8");
}

function loadJson(filePath, fallback) {
  try {
    return JSON.parse(fs.readFileSync(filePath, "utf8"));
  } catch {
    return fallback;
  }
}

function ensureDir(dir) {
  fs.mkdirSync(dir, { recursive: true });
}

function ensureFile(filePath, content) {
  if (!fs.existsSync(filePath)) {
    fs.writeFileSync(filePath, content, "utf8");
  }
}

function formatDateKey(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function lastNDates(days) {
  const items = [];
  for (let index = days - 1; index >= 0; index -= 1) {
    const current = new Date();
    current.setDate(current.getDate() - index);
    items.push(formatDateKey(current));
  }
  return items;
}

function createId() {
  return `${Date.now()}_${Math.random().toString(16).slice(2, 8)}`;
}

function shuffle(items) {
  const cloned = items.slice();
  for (let index = cloned.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(Math.random() * (index + 1));
    const temp = cloned[index];
    cloned[index] = cloned[pick];
    cloned[pick] = temp;
  }
  return cloned;
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let raw = "";
    req.on("data", (chunk) => {
      raw += chunk;
    });
    req.on("end", () => {
      if (!raw) {
        resolve({});
        return;
      }
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(error);
      }
    });
    req.on("error", reject);
  });
}

function respondJson(res, statusCode, payload) {
  res.writeHead(statusCode, { "Content-Type": "application/json; charset=utf-8" });
  res.end(JSON.stringify(payload));
}

function respondText(res, statusCode, text) {
  res.writeHead(statusCode, { "Content-Type": "text/plain; charset=utf-8" });
  res.end(text);
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}

function escapeRegExp(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

module.exports = {
  requestListener,
  runSchedulerCheck
};
