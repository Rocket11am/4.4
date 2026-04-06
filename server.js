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
  spoken: { label: "地道口语表达", reviewEligible: true, accent: "#00F5D4" },
  vocabulary: { label: "单词记忆", reviewEligible: true, accent: "#FF3AF2" },
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
  ai_frontier: "ai_news",
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
      respondEmailCompletePage(res);
      return;
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
    "/onboarding": "/onboarding.html",
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

  return {
    ok: true,
    profile: user
      ? {
          email: user.email,
          dailyCount: user.preferences.dailyCount,
          learningTypes: user.preferences.learningTypes,
          customTopic: user.preferences.customTopic,
          sendTime: user.preferences.sendTime,
          reviewEnabled: user.preferences.reviewEnabled,
          reviewTime: user.preferences.reviewTime,
          backupChannel: user.preferences.backupChannel,
          backupContact: user.preferences.backupContact
        }
      : null,
    stats,
    activeSession,
    history: sessions.slice(0, 12),
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

  if (!sessions.length) return 1;
  const avg = sessions.reduce((sum, session) => sum + session.quizResult.accuracy, 0) / sessions.length;
  if (avg > 80) return 3;
  if (avg < 50) return 1;
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

  const user = existing || { email, preferences, sessions: [], currentLevel: 1 };
  user.email = email;
  user.preferences = preferences;
  user.sessions = Array.isArray(user.sessions) ? user.sessions : [];
  user.currentLevel = deriveDifficultyLevel(user);
  store.users[key] = user;

  appendLog(`${email} 更新了学习订阅配置`);
  return user;
}

function getUser(email) {
  const cleanEmail = normalizeEmail(email).toLowerCase();
  return cleanEmail ? store.users[cleanEmail] || null : null;
}

async function sendMorningLesson(email, mode) {
  const user = upsertUser({ email });
  const today = formatDateKey(new Date());
  let session = sortSessions(user.sessions).find((item) => item.date === today);

  if (!session) {
    session = await createSession(user, mode);
    user.sessions.push(session);
  } else if (mode === "manual") {
    const regenerated = await buildDailyContent(user.preferences, deriveDifficultyLevel(user));
    session.items = regenerated.items;
    session.generationMode = regenerated.generationMode;
    session.reviewEligible = hasReviewableItems(regenerated.items);
    session.quiz = session.reviewEligible ? buildQuizForSession(session) : null;
    session.quizResult = null;
    session.quizSentAt = null;
    session.quizMode = null;
    session.createdAt = new Date().toISOString();
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

  const wrongItems = reviewed
    .filter((item) => !item.isCorrect)
    .map((item) => {
      const question = questions.find((q) => q.id === item.questionId) || {};
      return {
        id: createId(),
        date: formatDateKey(new Date()),
        sessionId,
        type: "custom",
        prompt: String(item.prompt || ""),
        answer: String(item.answer || ""),
        correctAnswer: String(item.correctAnswer || ""),
        hint: String(question.hint || ""),
        lastWrongAt: new Date().toISOString()
      };
    });

  session.quizResult = {
    submittedAt: new Date().toISOString(),
    score,
    total: questions.length,
    accuracy: questions.length ? Math.round((score / questions.length) * 100) : 0,
    answers: reviewed,
    wrongItems
  };

  appendLog(`${user.email} 完成了晚间测试，正确率 ${session.quizResult.accuracy}%`);
  saveStore();
  return {
    ok: true,
    message: `测试已提交，本次正确率 ${session.quizResult.accuracy}%`,
    state: buildClientState(user.email)
  };
}

async function createSession(user, mode) {
  const now = new Date();
  const difficultyLevel = deriveDifficultyLevel(user);
  const generated = await buildDailyContent(user.preferences, difficultyLevel);
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

async function buildDailyContent(preferences, level) {
  const types = normalizeLearningTypes(preferences.learningTypes);
  const count = normalizeDailyCount(preferences.dailyCount);

  const aiResult = await generateDailyContentWithArk(preferences, level, count);
  const uniqueItems = dedupeContentItems(aiResult.items || []);
  const fallbackItems = buildFallbackItems(preferences, level, count, uniqueItems);
  const mergedItems = dedupeContentItems([...uniqueItems, ...fallbackItems]).slice(0, count);

  return {
    items: mergedItems.map(normalizeContentItem),
    generationMode: aiResult.ok ? "ai+fallback" : "curated-fallback"
  };
}

function buildFallbackItems(preferences, level, targetCount, existingItems = []) {
  const types = normalizeLearningTypes(preferences.learningTypes);
  const fallback = [];
  const existingKeys = new Set(dedupeContentItems(existingItems).map(itemUniqKey));
  let index = 0;
  let guard = 0;
  const maxGuard = targetCount * 20;

  while (fallback.length < targetCount && guard < maxGuard) {
    guard += 1;
    const type = types[index % types.length];
    index += 1;
    let item = null;
    if (type === "custom") {
      item = buildCustomTopicItem(preferences.customTopic, level, index);
    } else {
      item = pickCuratedItem(type, level, [...existingItems, ...fallback]);
    }
    const key = itemUniqKey(item);
    if (!key || existingKeys.has(key)) continue;
    existingKeys.add(key);
    fallback.push(item);
  }

  let syntheticSerial = 1;
  while (fallback.length < targetCount) {
    const type = types[(index + fallback.length) % types.length] || "custom";
    const synthetic = buildSyntheticItem(type, preferences.customTopic, level, syntheticSerial);
    syntheticSerial += 1;
    const key = itemUniqKey(synthetic);
    if (!key || existingKeys.has(key)) {
      index += 1;
      continue;
    }
    existingKeys.add(key);
    fallback.push(synthetic);
  }

  return fallback;
}

function pickCuratedItem(type, level, usedItems = []) {
  const fallback = contentPool.filter((item) => item.type === type);
  const preferred = fallback.filter((item) => item.level === level);
  const source = preferred.length ? preferred : fallback.length ? fallback : contentPool;
  const usedKeys = new Set((Array.isArray(usedItems) ? usedItems : []).map(itemUniqKey));

  store.progress.typeCursor = store.progress.typeCursor || {};
  const cursor = Number(store.progress.typeCursor[type] || 0);
  let item = source[cursor % source.length];

  if (source.length > 1 && usedKeys.has(itemUniqKey(item))) {
    for (let step = 1; step < source.length; step += 1) {
      const candidate = source[(cursor + step) % source.length];
      if (!usedKeys.has(itemUniqKey(candidate))) {
        item = candidate;
        break;
      }
    }
  }

  const finalIndex = source.findIndex((entry) => entry.id === item.id);
  store.progress.typeCursor[type] = ((finalIndex >= 0 ? finalIndex : cursor) + 1) % source.length;

  return { ...item, source: "database" };
}

async function generateDailyContentWithArk(preferences, level, dailyCount) {
  if (!ARK_API_KEY || !ARK_MODEL) {
    return { ok: false, items: [] };
  }

  const learningTypes = normalizeLearningTypes(preferences.learningTypes);
  const customTopic = String(preferences.customTopic || "").trim();
  const newsContext = await buildHotNewsContext(learningTypes);
  const todayLabel = formatDateKey(new Date());
  const requestBody = {
    model: ARK_MODEL,
    temperature: 0.9,
    top_p: 0.95,
    max_tokens: 2200,
    response_format: { type: "json_object" },
    messages: [
      {
        role: "system",
        content: "你是中文每日学习内容生成助手。仅输出 JSON，不要输出任何解释文本。"
      },
      {
        role: "user",
        content: [
          `请生成 ${dailyCount} 条学习内容，要求：`,
          "1) 严格返回 JSON：{ \"items\": [...] }，items 长度必须等于请求条数。",
          "2) 不得重复：headline 不能重复，内容角度不能重复。",
          "3) 仅允许类型：spoken, vocabulary, finance, ai_news, custom。",
          `4) 本次类型优先：${learningTypes.join(", ")}。可混合分配但必须覆盖用户选中类型。`,
          `5) 难度等级：${level}（1-3）。spoken 与 vocabulary 难度要偏高、偏真实职场表达。`,
          `6) finance 与 ai_news 必须是“${todayLabel} 当日热点事件概述”，禁止写宽泛概念性内容。`,
          "7) finance/ai_news 每条必须包含 happenedAt(YYYY-MM-DD)、sourceName、sourceUrl 字段。",
          "8) finance/ai_news 的 headline 必须能对应到给定新闻线索中的具体事件。",
          `7) 如果类型为 custom，主题是：${customTopic || "用户自定义主题"}`,
          newsContext ? `8) 当日新闻线索（优先基于这些线索生成）：\n${newsContext}` : "8) 若新闻线索为空，尽量生成当日可验证事件并给出来源链接。",
          "9) 字段规则：",
          "- spoken: {type, headline(英文口语), chinese, scene, example, summary, takeaway}",
          "- vocabulary: {type, headline(英文单词/短语), phonetic, chinese, example, summary, takeaway}",
          "- finance/ai_news: {type, headline, chinese, summary, takeaway, keywords, happenedAt, sourceName, sourceUrl}",
          "- custom: {type, headline, chinese, summary, takeaway, keywords}",
          "10) 文本自然、具体，不要模板化重复句式。"
        ].join("\n")
      }
    ]
  };

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ARK_TIMEOUT_MS);
  try {
    const response = await fetch(`${ARK_BASE_URL}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${ARK_API_KEY}`,
        "Content-Type": "application/json"
      },
      body: JSON.stringify(requestBody),
      signal: controller.signal
    });

    if (!response.ok) {
      appendLog(`ARK 生成失败 HTTP ${response.status}`);
      return { ok: false, items: [] };
    }

    const data = await response.json();
    const raw = data?.choices?.[0]?.message?.content || "";
    const parsed = safeParseJsonObject(raw);
    const items = Array.isArray(parsed?.items) ? parsed.items : [];
    const normalized = dedupeContentItems(items).slice(0, dailyCount);
    return { ok: normalized.length > 0, items: normalized };
  } catch (error) {
    appendLog(`ARK 生成异常：${error.message}`);
    return { ok: false, items: [] };
  } finally {
    clearTimeout(timer);
  }
}

async function buildHotNewsContext(learningTypes) {
  const contexts = [];
  if (learningTypes.includes("finance")) {
    const financeNews = await fetchGoogleNewsRss("财经 OR 股市 OR 美联储 OR 纳斯达克 OR A股", 8);
    if (financeNews.length) {
      contexts.push(["[FINANCE]", ...financeNews.map((item, idx) => `${idx + 1}. ${item.title} | ${item.pubDate} | ${item.link}`)].join("\n"));
    }
  }
  if (learningTypes.includes("ai_news")) {
    const aiNews = await fetchGoogleNewsRss("人工智能 OR 大模型 OR OpenAI OR Anthropic OR Gemini OR AI Agent", 8);
    if (aiNews.length) {
      contexts.push(["[AI]", ...aiNews.map((item, idx) => `${idx + 1}. ${item.title} | ${item.pubDate} | ${item.link}`)].join("\n"));
    }
  }
  return contexts.join("\n\n");
}

async function fetchGoogleNewsRss(query, limit = 8) {
  const url = `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&hl=zh-CN&gl=CN&ceid=CN:zh-Hans`;
  try {
    const response = await fetch(url, {
      headers: { "User-Agent": "DailyLearningAssistant/1.0" }
    });
    if (!response.ok) return [];
    const xml = await response.text();
    const itemBlocks = xml.match(/<item>[\s\S]*?<\/item>/g) || [];
    const parsed = itemBlocks.map((block) => {
      const title = xmlDecode(matchTag(block, "title"));
      const link = matchTag(block, "link");
      const pubDateRaw = matchTag(block, "pubDate");
      const date = new Date(pubDateRaw);
      return {
        title: title.replace(/\s*-\s*Google 新闻$/i, "").trim(),
        link: link.trim(),
        pubDate: Number.isNaN(date.getTime()) ? formatDateKey(new Date()) : formatDateKey(date)
      };
    }).filter((item) => item.title && item.link);

    return dedupeNews(parsed).slice(0, limit);
  } catch (error) {
    appendLog(`抓取新闻线索失败: ${error.message}`);
    return [];
  }
}

function dedupeNews(items) {
  const seen = new Set();
  const result = [];
  (Array.isArray(items) ? items : []).forEach((item) => {
    const key = normalizeLoose(item.title);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function matchTag(xml, tag) {
  const reg = new RegExp(`<${tag}>([\\s\\S]*?)<\\/${tag}>`, "i");
  const matched = String(xml || "").match(reg);
  return matched && matched[1] ? matched[1] : "";
}

function xmlDecode(value) {
  return String(value || "")
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'");
}

function safeParseJsonObject(text) {
  const source = String(text || "").trim();
  if (!source) return {};
  try {
    return JSON.parse(source);
  } catch {}

  const fenceMatch = source.match(/```json\s*([\s\S]*?)```/i) || source.match(/```([\s\S]*?)```/i);
  if (fenceMatch && fenceMatch[1]) {
    try {
      return JSON.parse(fenceMatch[1].trim());
    } catch {}
  }

  const start = source.indexOf("{");
  const end = source.lastIndexOf("}");
  if (start >= 0 && end > start) {
    try {
      return JSON.parse(source.slice(start, end + 1));
    } catch {}
  }
  return {};
}

function itemUniqKey(item) {
  const type = normalizeItemType(item?.type);
  const headline = normalizeLoose(String(item?.headline || ""));
  const chinese = normalizeLoose(String(item?.chinese || ""));
  const summary = normalizeLoose(String(item?.summary || ""));
  return `${type}|${headline}|${chinese || summary}`;
}

function dedupeContentItems(items) {
  const seen = new Set();
  const result = [];
  (Array.isArray(items) ? items : []).forEach((raw) => {
    const item = normalizeContentItem(raw);
    const key = itemUniqKey(item);
    if (!key || seen.has(key)) return;
    seen.add(key);
    result.push(item);
  });
  return result;
}

function buildSyntheticItem(type, topic, level, serial) {
  if (type === "spoken") {
    return normalizeContentItem({
      id: createId(),
      type: "spoken",
      level,
      headline: `Could we align on the priority before we proceed? #${serial}`,
      chinese: "在继续之前，我们先对优先级达成一致可以吗？",
      scene: "项目推进前对齐优先级",
      example: "Could we align on the priority before we proceed so we avoid rework?",
      summary: "高频职场沟通表达，强调先对齐再执行。",
      takeaway: "用于会议推进和任务澄清。"
    });
  }
  if (type === "vocabulary") {
    return normalizeContentItem({
      id: createId(),
      type: "vocabulary",
      level,
      headline: `prioritize-${serial}`,
      phonetic: "/praɪˈɔːrətaɪz/",
      chinese: "确定优先级",
      example: "We need to prioritize high-impact tasks this week.",
      summary: "用于项目管理和时间管理语境。",
      takeaway: "和 allocate、focus 常一起出现。"
    });
  }
  if (type === "finance") {
    return normalizeContentItem({
      id: createId(),
      type: "finance",
      level,
      headline: `Market Watch #${serial}: Risk sentiment shifts after key macro data`,
      chinese: "关键宏观数据公布后，市场风险偏好出现切换",
      summary: "当日关注重点是资金在防御和成长板块之间的轮动方向。",
      takeaway: "先看数据是否超预期，再看成交量与板块扩散。",
      happenedAt: formatDateKey(new Date()),
      sourceName: "市场公开资讯聚合",
      sourceUrl: "",
      keywords: ["宏观数据", "风险偏好"]
    });
  }
  if (type === "ai_news") {
    return normalizeContentItem({
      id: createId(),
      type: "ai_news",
      level,
      headline: `AI Frontline #${serial}: Model efficiency optimization becomes the new battleground`,
      chinese: "模型效率优化成为新一轮竞争焦点",
      summary: "业界继续围绕推理成本、响应延迟和稳定性展开工程优化。",
      takeaway: "评估方案时同时比较质量、成本和延迟三项指标。",
      happenedAt: formatDateKey(new Date()),
      sourceName: "AI 行业公开资讯聚合",
      sourceUrl: "",
      keywords: ["模型效率", "推理优化"]
    });
  }
  return buildCustomTopicItem(topic, level, serial);
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
    questions: reviewItems.map((item, index) => buildChoiceQuestion(session.id, item, index)).filter(Boolean)
  };
}

function buildChoiceQuestion(sessionId, item, index) {
  const id = `${sessionId}-${index + 1}`;

  if (item.type === "spoken") {
    const spokenPool = contentPool.filter((entry) => entry.type === "spoken");
    let distractors = shuffle(
      spokenPool
        .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
        .map((entry) => entry.chinese)
    ).slice(0, 6);
    if (distractors.length < 3) {
      const fallback = [
        "这句话表示事情合理、有道理",
        "这句话表示需要延期讨论",
        "这句话表示仍在探索中"
      ].filter((text) => normalizeLoose(text) !== normalizeLoose(item.chinese));
      distractors = dedupeStrings([...distractors, ...fallback]).slice(0, 3);
    }
    return {
      id,
      type: "choice",
      prompt: `这句口语最贴近哪一个中文含义？${item.headline}`,
      answer: item.chinese,
      options: shuffle(dedupeStrings([item.chinese, ...distractors]).slice(0, 4)),
      hint: item.scene || ""
    };
  }

  const vocabularyPool = contentPool.filter((entry) => entry.type === "vocabulary");
  let distractors = shuffle(
    vocabularyPool
      .filter((entry) => normalizeLoose(entry.chinese) !== normalizeLoose(item.chinese))
      .map((entry) => entry.chinese)
  ).slice(0, 6);
  if (distractors.length < 3) {
    const fallback = [
      "有韧性的",
      "可持续的",
      "准确的",
      "分配"
    ].filter((text) => normalizeLoose(text) !== normalizeLoose(item.chinese));
    distractors = dedupeStrings([...distractors, ...fallback]).slice(0, 3);
  }
  return {
    id,
    type: "choice",
    prompt: `“${item.headline}” 最准确的中文释义是？`,
    answer: item.chinese,
    options: shuffle(dedupeStrings([item.chinese, ...distractors]).slice(0, 4)),
    hint: item.phonetic || ""
  };
}

function dedupeStrings(values) {
  const seen = new Set();
  const result = [];
  (Array.isArray(values) ? values : []).forEach((value) => {
    const text = String(value || "").trim();
    const key = normalizeLoose(text);
    if (!text || seen.has(key)) return;
    seen.add(key);
    result.push(text);
  });
  return result;
}

function compareAnswer(input, answer) {
  return normalizeLoose(input) === normalizeLoose(answer);
}

function hasReviewableItems(items) {
  return items.some((item) => TYPE_META[normalizeItemType(item.type)]?.reviewEligible);
}

function getSchedulerDateParts(now = new Date()) {
  const timezone = process.env.SCHEDULER_TIMEZONE || process.env.APP_TIMEZONE || "Asia/Shanghai";
  try {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      hour12: false
    }).formatToParts(now);
    const pick = (type) => parts.find((part) => part.type === type)?.value || "";
    const y = pick("year");
    const m = pick("month");
    const d = pick("day");
    const hh = pick("hour");
    const mm = pick("minute");
    if (y && m && d && hh && mm) {
      return { dateKey: `${y}-${m}-${d}`, time: `${hh}:${mm}` };
    }
  } catch {}
  return {
    dateKey: formatDateKey(now),
    time: `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`
  };
}

function runSchedulerCheck() {
  const parts = getSchedulerDateParts(new Date());
  const minuteKey = `${parts.dateKey} ${parts.time}`;
  if (schedulerMinuteKey === minuteKey) return;
  schedulerMinuteKey = minuteKey;
  const currentTime = parts.time;

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
  const dashboardUrl = buildTrackedLink(baseUrl, {
    email,
    sessionId: session.id,
    slot: "morning",
    action: "dashboard",
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
          <a href="${dashboardUrl}" style="display:inline-block;padding:14px 20px;background:#24124b;border:4px dashed #00F5D4;border-radius:999px;color:#ffffff;font-weight:800;text-decoration:none;">打开学习面板</a>
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
      currentLevel: Number(user?.currentLevel || 1)
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
    sendTime: validTime(String(input?.sendTime || input?.morningTime || "")) || "07:30",
    reviewEnabled,
    reviewTime: validTime(String(input?.reviewTime || input?.eveningTime || "")) || "20:30",
    backupChannel: normalizeBackupChannel(input?.backupChannel),
    backupContact: String(input?.backupContact || "").trim()
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
    source: String(item?.source || "database"),
    happenedAt: String(item?.happenedAt || ""),
    sourceName: String(item?.sourceName || ""),
    sourceUrl: String(item?.sourceUrl || "")
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
          answers: Array.isArray(session.quizResult.answers) ? session.quizResult.answers : [],
          wrongItems: Array.isArray(session.quizResult.wrongItems) ? session.quizResult.wrongItems : []
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
    { id: "ai-1", type: "ai_news", level: 1, headline: "Major model providers cut inference cost for long-context workloads", chinese: "多家大模型厂商下调长上下文推理成本", summary: "价格和吞吐优化推动企业把更多核心场景迁移到 API 生产环境。", takeaway: "关注“单位 token 成本 + 延迟 + 稳定性”这三项是否同时改善。", keywords: ["推理成本", "企业落地"] },
    { id: "ai-2", type: "ai_news", level: 1, headline: "Open-source multimodal stacks accelerate private deployment", chinese: "开源多模态技术栈加速私有化部署", summary: "企业越来越倾向于“开源模型 + 自建数据管线”以平衡成本与可控性。", takeaway: "评估 AI 方案时，把“模型能力”与“工程可运维性”分开看。", keywords: ["开源模型", "私有化"] },
    { id: "ai-3", type: "ai_news", level: 2, headline: "Agent orchestration becomes a bottleneck in production teams", chinese: "Agent 编排能力成为生产落地瓶颈", summary: "从单模型问答走向多 Agent 工作流后，监控、回滚、权限治理需求显著上升。", takeaway: "把 AI 项目当作软件工程系统建设，而不只是模型调用。", keywords: ["Agent", "工程治理"] },
    { id: "ai-4", type: "ai_news", level: 2, headline: "Vendors race to ship retrieval tuning for domain-specific accuracy", chinese: "厂商竞相推出检索增强调优能力以提升垂直准确率", summary: "越来越多团队把效果提升重点放在检索质量、分块策略和重排模型上。", takeaway: "提升准确率时，优先优化“数据与检索”，再微调提示词。", keywords: ["RAG", "准确率"] },
    { id: "ai-5", type: "ai_news", level: 3, headline: "AI governance standards tighten around data lineage and auditability", chinese: "AI 治理标准收紧，强调数据血缘与可审计性", summary: "监管和企业内控都在要求训练与推理链路可追踪、可解释、可复盘。", takeaway: "从早期就为日志、版本和审计留接口，避免后期返工。", keywords: ["治理", "合规"] }
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
    const sourcePart = [item.happenedAt, item.sourceName].filter(Boolean).join(" · ");
    return `${item.chinese}｜摘要：${item.summary}｜启发：${item.takeaway}${sourcePart ? `｜来源：${sourcePart}` : ""}`;
  }
  if (item.type === "ai_news") {
    const sourcePart = [item.happenedAt, item.sourceName].filter(Boolean).join(" · ");
    return `${item.chinese || item.headline}｜摘要：${item.summary}｜启发：${item.takeaway}${sourcePart ? `｜来源：${sourcePart}` : ""}`;
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
    return `${item.headline} | ${item.chinese} | ${item.summary} | ${item.happenedAt || ""} ${item.sourceName || ""}`.trim();
  }
  if (item.type === "ai_news") {
    return `${item.headline} | ${item.chinese || ""} | ${item.summary} | ${item.happenedAt || ""} ${item.sourceName || ""}`.trim();
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
    if (clean === "all") return ["vocabulary", "spoken", "finance", "ai_news"];
    const mappedType = LEGACY_TYPE_MAP[clean];
    return mappedType ? [mappedType] : [];
  });

  const unique = [...new Set(mapped)];
  return unique.length ? unique : ["vocabulary"];
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
