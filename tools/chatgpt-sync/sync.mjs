import { createHash } from "node:crypto";
import { mkdir, readFile, readdir, rename, unlink, writeFile } from "node:fs/promises";
import path from "node:path";
import katex from "katex";

const MAX_MESSAGES = 240;
const MAX_MESSAGE_CHARS = 500_000;
const MAX_TOTAL_CHARS = 4_000_000;

const TOPIC_RULES = [
  ["AI 与大模型", /大模型|llm|transformer|机器学习|深度学习|rag|embedding|rerank|query rewrite|向量检索|多路召回|agent/i, ["AI", "大模型"]],
  ["算法与数据结构", /算法|数据结构|leetcode|动态规划|二叉树|链表|排序|查找|复杂度/i, ["算法", "数据结构"]],
  ["计算机网络", /计算机网络|tcp|udp|http|https|dns|网络协议|拥塞控制|三次握手/i, ["计算机网络"]],
  ["操作系统", /操作系统|进程|线程|协程|死锁|虚拟内存|页面置换|文件系统/i, ["操作系统"]],
  ["数据库", /数据库|mysql|postgres|sql|事务|索引|mvcc|redis|缓存/i, ["数据库"]],
  ["Java", /java|jvm|spring|mybatis|垃圾回收|并发编程/i, ["Java"]],
  ["前端", /前端|javascript|typescript|vue|react|浏览器|css|webpack|vite/i, ["前端"]],
  ["Python", /python|django|flask|fastapi|pytorch|pandas/i, ["Python"]],
  ["C++", /c\+\+|cpp|stl|智能指针|内存管理/i, ["C++"]],
  ["系统设计", /系统设计|分布式|微服务|消息队列|高并发|负载均衡|一致性|架构设计/i, ["系统设计"]],
  ["项目与行为面试", /项目经历|自我介绍|行为面试|hr面|职业规划|团队合作|项目难点/i, ["项目面试"]],
];

function cleanText(value, maxLength = MAX_MESSAGE_CHARS) {
  return String(value ?? "")
    .replace(/\r\n?/g, "\n")
    .replace(/[ \t]+\n/g, "\n")
    .trim()
    .slice(0, maxLength);
}

function configuredDefaultTags() {
  return String(process.env.CHATGPT_SYNC_DEFAULT_TAGS || "")
    .split(/[,，]/)
    .map((tag) => cleanText(tag, 24))
    .filter(Boolean);
}

function yamlString(value) {
  return JSON.stringify(cleanText(value, 500));
}

function datePart(value = new Date()) {
  const date = value instanceof Date ? value : new Date(value);
  const validDate = Number.isNaN(date.getTime()) ? new Date() : date;
  const year = validDate.getFullYear();
  const month = String(validDate.getMonth() + 1).padStart(2, "0");
  const day = String(validDate.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function hash(value, length = 16) {
  return createHash("sha256").update(value).digest("hex").slice(0, length);
}

function answerMatchId(answer) {
  const normalized = cleanText(answer)
    .replace(/^#{1,6}\s+/gm, "")
    .replace(/[*_`~]/g, "")
    .replace(/\s+/g, " ")
    .slice(0, 12_000);
  return hash(normalized);
}

function escapeHtml(value) {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

function atomicWrite(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  return writeFile(temporaryPath, content, "utf8").then(() => rename(temporaryPath, filePath));
}

async function loadDecisionCache(projectRoot) {
  const filePath = path.join(projectRoot, ".chatgpt-sync", "classification-decisions.json");
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content) return { decisions: {}, duplicateResolutions: {}, filePath, semanticMatches: {}, version: 2 };
  try {
    const parsed = JSON.parse(content);
    return {
      decisions: parsed?.decisions && typeof parsed.decisions === "object" ? parsed.decisions : {},
      duplicateResolutions:
        parsed?.duplicateResolutions && typeof parsed.duplicateResolutions === "object" ? parsed.duplicateResolutions : {},
      semanticMatches:
        parsed?.semanticMatches && typeof parsed.semanticMatches === "object" ? parsed.semanticMatches : {},
      filePath,
      version: 2,
    };
  } catch {
    return { decisions: {}, duplicateResolutions: {}, filePath, semanticMatches: {}, version: 2 };
  }
}

async function saveDecisionCache(cache) {
  await mkdir(path.dirname(cache.filePath), { recursive: true });
  await atomicWrite(
    cache.filePath,
    `${JSON.stringify({ decisions: cache.decisions, duplicateResolutions: cache.duplicateResolutions, semanticMatches: cache.semanticMatches, version: 2 }, null, 2)}\n`,
  );
}

export function slugify(value) {
  const slug = cleanText(value, 100)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 54)
    .replace(/-+$/g, "");

  return slug || "chatgpt-note";
}

export function questionKey(value) {
  return cleanText(value, 1_000)
    .toLowerCase()
    .normalize("NFKC")
    .replace(/^#{1,6}\s*/gm, "")
    .replace(/^\d{1,3}[.、．]\s*/, "")
    .replace(/c\+\+/gi, "cplusplus")
    .replace(/c#/gi, "csharp")
    .replace(/[^\p{Letter}\p{Number}]+/gu, "");
}

export function inferTopic(text) {
  for (const [category, matcher, tags] of TOPIC_RULES) {
    if (matcher.test(text)) return { category, tags };
  }

  return { category: "综合复习", tags: ["综合"] };
}

export function inferCollectionTitle(text, category) {
  if (/\brag\b|embedding|rerank|query rewrite|向量检索|多路召回|混合检索/i.test(text)) return "RAG 面试题";
  if (/\bagent\b|tool call|工具调用|智能体/i.test(text)) return "Agent 面试题";
  if (category === "AI 与大模型") return "大模型面试题";
  if (category === "综合复习") return "综合面试题";
  return `${category}面试题`;
}

function parseYamlScalar(value, fallback = "") {
  const raw = String(value ?? "").trim();
  if (!raw) return fallback;
  try {
    const parsed = JSON.parse(raw);
    return typeof parsed === "string" ? parsed : fallback;
  } catch {
    return raw.replace(/^['"]|['"]$/g, "") || fallback;
  }
}

function labelKey(value) {
  return slugify(value).replace(/-?面试题$/u, "");
}

function findMatchingCollection(collections, title) {
  const key = labelKey(title);
  return collections.find((collection) => labelKey(collection.collectionTitle) === key) || null;
}

function normalizedCollectionTitle(value, fallback) {
  const title = cleanText(value, 40).replace(/[\/\\:*?"<>|]/g, "").trim();
  if (!title) return fallback;
  return /面试题$/u.test(title) ? title : `${title}面试题`;
}

function userCollectionTitle(value) {
  const title = cleanText(value, 40).replace(/[\/\\:*?"<>|]/g, "").trim();
  if (!title) throw new Error("分类名称不能为空");
  return title;
}

export function shouldStoreQuestion(question) {
  const text = cleanText(question, 3_000);
  const metaInstruction = [
    /(?:从现在开始|接下来|后续).{0,50}(?:回答|回复|输出).{0,30}(?:格式|要求|遵循|使用)/is,
    /(?:我希望|请|麻烦)?你?(?:后面|之后|接下来|后续|以后)的?(?:每次)?(?:回答|回复|输出).{0,140}(?:先|首先|然后|再|格式|结构|方式|模拟|简要|详细)/is,
    /(?:回答|回复|输出)(?:时|的时候)?\s*(?:必须|需要|请|都要|都是)?\s*(?:先|首先).{0,100}(?:然后|再|最后)/is,
    /^(?:system\s*prompt|系统提示词|角色设定)\s*[:：]?/i,
    /^(?:你现在是|你是一个|你是|请扮演|请充当).{0,100}(?:助手|面试官|老师|专家|教练)/is,
    /^(?:请)?(?:始终|统一|以后|接下来)?(?:使用|采用|按照).{0,40}(?:markdown|json|中文|英文|格式).{0,30}(?:回答|回复|输出)/is,
  ].some((matcher) => matcher.test(text));
  const substantiveQuestion = /什么|为什么|如何|怎么|哪些|区别|原理|实现|分析|解释|介绍|设计|优化|排查|\?/i.test(text);
  return !metaInstruction || substantiveQuestion;
}

export function resolveQuestionClassification(question, modelResult, existingCollections = [], answerExcerpt = "") {
  if (!shouldStoreQuestion(question) || modelResult?.shouldStore === false) {
    return {
      shouldStore: false,
      skipReason: cleanText(modelResult?.skipReason, 120) || "属于提示词、格式约束或非复习内容",
    };
  }

  const classificationText = `${question}\n${answerExcerpt}`;
  const inferred = inferTopic(classificationText);
  const fallbackTitle = inferCollectionTitle(classificationText, inferred.category);
  const fallbackExisting = findMatchingCollection(existingCollections, fallbackTitle);
  const rawTitle = normalizedCollectionTitle(modelResult?.collectionTitle, fallbackTitle);
  const selectedExisting = findMatchingCollection(existingCollections, rawTitle);
  const wantsExisting = modelResult?.action === "use_existing";
  const existing = selectedExisting || (wantsExisting ? fallbackExisting : null);
  const requestedTags = Array.isArray(modelResult?.tags) ? modelResult.tags : [];

  if (existing) {
    return {
      category: existing.category || inferred.category,
      collectionTitle: existing.collectionTitle,
      tags: [...new Set([...configuredDefaultTags(), ...existing.tags, ...requestedTags, ...inferred.tags].map((tag) => cleanText(tag, 24)).filter(Boolean))].slice(0, 8),
      shouldStore: true,
      usedExisting: true,
    };
  }

  return {
    category: cleanText(modelResult?.category, 40) || inferred.category,
    collectionTitle: rawTitle,
    shouldStore: true,
    tags: [...new Set([...configuredDefaultTags(), ...requestedTags, ...inferred.tags].map((tag) => cleanText(tag, 24)).filter(Boolean))].slice(0, 8),
    usedExisting: false,
  };
}

function titleFromMarkdown(markdown, fallback) {
  const line = cleanText(markdown)
    .split("\n")
    .map((item) => item.trim())
    .find((item) => item && !/^```/.test(item) && !/^---$/.test(item));
  const title = (line || fallback)
    .replace(/\\sqrt\s*\{([^{}]+)\}/g, "√$1")
    .replace(/\\(?:left|right)\s*/g, "")
    .replace(/\\([()[\]])/g, "$1")
    .replace(/\${1,2}/g, "")
    .replace(/[{}]/g, "")
    .replace(/_k\b/g, "ₖ")
    .replace(/^#{1,6}\s+/, "")
    .replace(/^>\s*/, "")
    .replace(/^[-*+]\s+/, "")
    .replace(/[*_`~]/g, "")
    .replace(/[：:]$/, "")
    .trim();

  return title.slice(0, 88) || fallback;
}

function numberedQuestion(question, sequence) {
  const firstLine = titleFromMarkdown(question, `问题 ${sequence}`);
  const explicit = firstLine.match(/^(\d{1,3})[.、．]\s*(.+)$/);
  const order = explicit ? Number(explicit[1]) : sequence;
  const title = explicit ? explicit[2].trim() : firstLine;
  return { explicitOrder: Boolean(explicit), order, title };
}

function demoteHeadings(markdown) {
  let inFence = false;
  return markdown
    .split("\n")
    .map((line) => {
      if (/^\s*```/.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(/^(#{1,6})(\s+)/, (_match, marks, spacing) => `${"#".repeat(Math.min(6, marks.length + 2))}${spacing}`);
    })
    .join("\n");
}

function renderQuestionHtml(question) {
  const mathPattern =
    /\\\(([\s\S]*?)\\\)|\\\[([\s\S]*?)\\\]|\$\$([\s\S]*?)\$\$|\$([^$\n]+?)\$|\(([^()\n]*(?:\\[a-zA-Z]+|[_^{}])[^()\n]*)\)/g;
  let cursor = 0;
  let html = "";

  for (const match of question.matchAll(mathPattern)) {
    html += escapeHtml(question.slice(cursor, match.index)).replaceAll("\n", "<br>");
    const expression = match[1] ?? match[2] ?? match[3] ?? match[4] ?? match[5];
    const displayMode = match[2] !== undefined || match[3] !== undefined;
    try {
      html += katex.renderToString(expression.trim(), { displayMode, throwOnError: true });
    } catch {
      html += escapeHtml(match[0]);
    }
    cursor = match.index + match[0].length;
  }

  return html + escapeHtml(question.slice(cursor)).replaceAll("\n", "<br>");
}

export function pairTurns(messages) {
  const turns = [];
  let pendingQuestion = null;
  const occurrences = new Map();

  const addTurn = (question, answer, inferredQuestion = false, stableMessageId = "") => {
    const sequence = turns.length + 1;
    const display = numberedQuestion(question, sequence);
    const resolvedAnswer = answer || "当前问题尚未同步到 ChatGPT 回答。";
    const occurrence = (occurrences.get(question) || 0) + 1;
    occurrences.set(question, occurrence);
    turns.push({
      answer: resolvedAnswer,
      answerId: hash(resolvedAnswer),
      answerMatchId: answerMatchId(resolvedAnswer),
      displayTitle: `${display.order}. ${display.title}`,
      explicitOrder: display.explicitOrder,
      inferredQuestion,
      order: display.order,
      question,
      title: display.title,
      turnId: stableMessageId ? hash(`message:${stableMessageId}`) : hash(`${question}\n${occurrence}`),
    });
  };

  for (const message of messages) {
    if (message.role === "user") {
      if (pendingQuestion) addTurn(pendingQuestion.content, "", false, pendingQuestion.messageId);
      pendingQuestion = message;
      continue;
    }

    if (pendingQuestion) {
      addTurn(pendingQuestion.content, message.content, false, message.messageId || pendingQuestion.messageId);
      pendingQuestion = null;
    } else {
      const inferredTitle = titleFromMarkdown(message.content, `根据回答整理的问题 ${turns.length + 1}`);
      addTurn(inferredTitle, message.content, true, message.messageId);
    }
  }

  if (pendingQuestion) addTurn(pendingQuestion.content, "", false, pendingQuestion.messageId);
  return turns;
}

export function selectMessagesForSync(messages, syncScope = "conversation") {
  if (syncScope !== "last" || messages.length <= 1) return messages;
  const lastMessage = messages.at(-1);
  if (lastMessage.role === "user") return [lastMessage];

  const assistantIndex = messages.findLastIndex((message) => message.role === "assistant");
  if (assistantIndex < 0) return [lastMessage];
  const userIndex = messages
    .slice(0, assistantIndex)
    .findLastIndex((message) => message.role === "user");
  return userIndex < 0 ? [messages[assistantIndex]] : [messages[userIndex], messages[assistantIndex]];
}

export function normalizePayload(input) {
  if (!input || typeof input !== "object") throw new Error("请求内容不是有效对象");

  const rawMessages = Array.isArray(input.messages) ? input.messages : [];
  const syncScope = input.syncScope === "last" ? "last" : "conversation";
  const normalizedMessages = rawMessages
    .slice(syncScope === "last" ? -MAX_MESSAGES : 0, syncScope === "last" ? undefined : MAX_MESSAGES)
    .map((message) => ({
      role: message?.role === "assistant" ? "assistant" : message?.role === "user" ? "user" : "",
      content: cleanText(message?.content),
      messageId: cleanText(message?.messageId, 200).replace(/[^a-zA-Z0-9_-]/g, ""),
    }))
    .filter(
      (message) =>
        message.role &&
        message.content &&
        !(
          message.role === "assistant" &&
          /^(?:正在(?:思考|分析)(?:\s*\d*\s*幅?图片)?[.…。]*|thinking\.{0,3}|analyzing(?:\s+images?)?\.{0,3})$/i.test(message.content)
        ),
    );
  const messages = selectMessagesForSync(normalizedMessages, syncScope);

  if (!messages.length) throw new Error("没有找到可同步的对话内容");

  const totalChars = messages.reduce((sum, message) => sum + message.content.length, 0);
  if (totalChars > MAX_TOTAL_CHARS) throw new Error("当前对话过长，请拆分后再同步");

  const firstQuestion = messages.find((message) => message.role === "user")?.content ?? messages[0].content;
  const sourceTitle = cleanText(input.title, 100) || titleFromMarkdown(firstQuestion, "ChatGPT 对话");
  const sourceUrl = cleanText(input.sourceUrl, 1_000);

  if (sourceUrl && !/^https:\/\/(chatgpt\.com|chat\.openai\.com)(\/|$)/i.test(sourceUrl)) {
    throw new Error("仅允许同步 ChatGPT 页面");
  }

  const fallbackId = hash(`${sourceUrl}\n${firstQuestion}`, 20);
  const conversationId = cleanText(input.conversationId, 120).replace(/[^a-zA-Z0-9_-]/g, "") || fallbackId;
  const questionText = messages.filter((message) => message.role === "user").map((message) => message.content).join("\n") || firstQuestion;
  const inferred = inferTopic(questionText);
  const category = cleanText(input.category, 40) || inferred.category;
  const requestedTags = Array.isArray(input.tags) ? input.tags : [];
  const tags = [...new Set([...configuredDefaultTags(), ...requestedTags, ...inferred.tags].map((tag) => cleanText(tag, 24)).filter(Boolean))].slice(0, 8);

  return {
    category,
    classificationMode: input.classificationMode === "fixed" ? "fixed" : "llm",
    collectionTitle: inferCollectionTitle(questionText, category),
    conversationId,
    createdAt: datePart(input.createdAt),
    messages,
    redirectPath: /^\/interview\/chatgpt\/[\p{Letter}\p{Number}._%/-]+\.html$/u.test(cleanText(input.redirectPath, 500))
      ? cleanText(input.redirectPath, 500)
      : "",
    sourceTitle,
    sourceUrl,
    syncScope,
    fixedCollectionId: cleanText(input.fixedCollectionId, 100),
    fixedCollectionTitle: cleanText(input.fixedCollectionTitle, 80),
    tags,
    turns: pairTurns(messages),
  };
}

export function renderQuestionMarkdown(conversation, turn, originalDate = conversation.createdAt, redirectFrom = "") {
  const questionHtml = renderQuestionHtml(turn.question);
  const answer = demoteHeadings(turn.answer);
  const frontmatter = [
    "---",
    `title: ${yamlString(turn.displayTitle)}`,
    "icon: asterisk",
    `order: ${turn.order}`,
    `date: ${originalDate}`,
    `updated: ${datePart()}`,
    "category:",
    `  - ${yamlString(conversation.category)}`,
    "tag:",
    ...conversation.tags.map((tag) => `  - ${yamlString(tag)}`),
    "pageClass: interview-note",
    "comment: false",
    "editLink: false",
    ...(redirectFrom ? [`redirectFrom: ${yamlString(redirectFrom)}`] : []),
    "source: ChatGPT",
    `sourceUrl: ${yamlString(conversation.sourceUrl)}`,
    `chatgptCollectionTitle: ${yamlString(conversation.collectionTitle)}`,
    `chatgptConversationId: ${yamlString(conversation.conversationId)}`,
    `chatgptTurnId: ${yamlString(turn.turnId)}`,
    `chatgptAnswerId: ${yamlString(turn.answerId)}`,
    `chatgptAnswerMatchId: ${yamlString(turn.answerMatchId)}`,
    "---",
    "",
    '<div class="interview-question-card">',
    '  <span class="interview-question-kicker">INTERVIEW QUESTION</span>',
    `  <p>${questionHtml}</p>`,
    "</div>",
    "",
  ];

  if (turn.inferredQuestion) {
    frontmatter.push(
      '<aside class="interview-inference-note">',
      "  <strong>题目来源提示</strong>",
      "  <span>当前 ChatGPT 页面没有提供这轮用户问题，页面标题依据回答首段提取。重新同步后若能读取原问题，会自动更新。</span>",
      "</aside>",
      "",
    );
  }

  const body = ["## 参考答案", "", answer, ""];
  if (conversation.sourceUrl) body.push("---", "", `[打开原始 ChatGPT 对话](${conversation.sourceUrl})`, "");

  return `${[...frontmatter, ...body].join("\n").trim()}\n`;
}

export function renderConversationIndex(collection, pages) {
  const collectionTitle = collection.collectionTitle;
  const lines = [
    "---",
    `title: ${yamlString(collectionTitle)}`,
    `chatgptCategory: ${yamlString(collection.category || "自定义分类")}`,
    "icon: folder-open",
    "article: false",
    "index: false",
    "comment: false",
    "editLink: false",
    "---",
    "",
    `> 本组共 ${pages.length} 道题，由同步服务按主题自动整理。新增问题会先匹配已有分类，确实不合适时才创建新分类。`,
    "",
    "## 问题目录",
    "",
    ...pages.map((page) => `- [${page.turn.displayTitle}](./${page.filename.replace(/\.md$/, ".html")})`),
    "",
  ];
  return `${lines.join("\n").trim()}\n`;
}

function frontmatterValue(content, name, fallback = "") {
  return parseYamlScalar(content.match(new RegExp(`^${name}:\\s*(.+)$`, "m"))?.[1], fallback);
}

function frontmatterList(content, name) {
  const block = content.match(new RegExp(`^${name}:\\s*\\n((?:\\s+-\\s*.*(?:\\n|$))+)`, "m"))?.[1] || "";
  return block
    .split("\n")
    .map((line) => parseYamlScalar(line.replace(/^\s+-\s*/, "")))
    .filter(Boolean);
}

async function findLegacyFiles(rootDir, conversationId) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const marker = `chatgptConversationId: ${yamlString(conversationId)}`;
  const files = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const filePath = path.join(rootDir, entry.name);
    const content = await readFile(filePath, "utf8");
    if (content.slice(0, 2_000).includes(marker)) files.push(filePath);
  }

  return files;
}

async function readQuestionFile(filePath) {
  const content = await readFile(filePath, "utf8");
  const displayTitle = frontmatterValue(content, "title", "问题");
  const order = Number(content.match(/^order:\s*(\d+)$/m)?.[1] || 0);
  const answerMarker = "\n## 参考答案\n";
  const answerStart = content.indexOf(answerMarker);
  const answerEnd = content.lastIndexOf("\n---\n\n[打开原始 ChatGPT 对话]");
  const answer =
    answerStart >= 0
      ? cleanText(content.slice(answerStart + answerMarker.length, answerEnd > answerStart ? answerEnd : undefined))
      : "";
  const turnId = frontmatterValue(content, "chatgptTurnId");
  const answerId = frontmatterValue(content, "chatgptAnswerId") || (answer ? hash(answer) : "");
  const resolvedAnswerMatchId = frontmatterValue(content, "chatgptAnswerMatchId") || (answer ? answerMatchId(answer) : "");

  return {
    answer,
    answerId,
    answerLength: answer.length,
    answerMatchId: resolvedAnswerMatchId,
    category: frontmatterList(content, "category")[0] || "",
    collectionDir: path.dirname(filePath),
    collectionTitle: frontmatterValue(content, "chatgptCollectionTitle"),
    content,
    conversationId: frontmatterValue(content, "chatgptConversationId"),
    filePath,
    originalDate: frontmatterValue(content, "date"),
    redirectFrom: frontmatterValue(content, "redirectFrom"),
    tags: frontmatterList(content, "tag"),
    turn: {
      displayTitle,
      explicitOrder: true,
      inferredQuestion: content.includes('class="interview-inference-note"'),
      order,
      title: displayTitle.replace(/^\d+[.、．]\s*/, ""),
      turnId,
    },
    turnId,
  };
}

async function readCollectionDirectory(collectionDir) {
  const entries = await readdir(collectionDir, { withFileTypes: true });
  const indexContent = await readFile(path.join(collectionDir, "README.md"), "utf8").catch(() => "");
  const pages = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
    const page = await readQuestionFile(path.join(collectionDir, entry.name)).catch(() => null);
    if (page) pages.push(page);
  }

  pages.sort((left, right) => left.turn.order - right.turn.order || left.filePath.localeCompare(right.filePath, "zh-CN"));
  const collectionTitle = frontmatterValue(indexContent, "title", path.basename(collectionDir));
  const category =
    pages.find((page) => page.category)?.category ||
    frontmatterValue(indexContent, "chatgptCategory") ||
    collectionTitle.replace(/面试题$/u, "") ||
    "综合复习";
  const tags = [...new Set(pages.flatMap((page) => page.tags))].slice(0, 8);

  for (const page of pages) page.collectionTitle ||= collectionTitle;
  return {
    category,
    collectionId: path.basename(collectionDir),
    collectionDir,
    collectionTitle,
    pages,
    samples: pages.slice(0, 5).map((page) => page.turn.title),
    tags,
  };
}

async function scanCollections(rootDir) {
  const entries = await readdir(rootDir, { withFileTypes: true });
  const collections = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    collections.push(await readCollectionDirectory(path.join(rootDir, entry.name)));
  }
  return collections;
}

export async function listCollections(projectRoot) {
  const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
  await mkdir(rootDir, { recursive: true });
  const collections = await scanCollections(rootDir);
  return collections
    .map(({ category, collectionId, collectionTitle, pages }) => ({
      category,
      collectionId,
      collectionTitle,
      questionCount: pages.length,
    }))
    .sort((left, right) => left.collectionTitle.localeCompare(right.collectionTitle, "zh-CN"));
}

export async function verifyLastQuestion(projectRoot, input) {
  const conversation = normalizePayload(input);
  const turn = conversation.turns.at(-1);
  if (!turn || conversation.messages.at(-1)?.role !== "assistant") {
    return {
      status: "incomplete",
      stored: false,
      reason: "最后一道问题还没有完整回答",
    };
  }

  const decisionCache = await loadDecisionCache(projectRoot);
  const decisionKey = hash(`${conversation.conversationId}:${turn.turnId}`, 24);
  const skippedDecision = decisionCache.decisions[decisionKey];
  if (!shouldStoreQuestion(turn.question) || skippedDecision?.shouldStore === false) {
    return {
      question: turn.displayTitle,
      reason: cleanText(skippedDecision?.skipReason, 120) || "属于提示词、格式约束或非复习内容",
      status: "skipped",
      stored: false,
    };
  }

  const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
  await mkdir(rootDir, { recursive: true });
  const pages = (await scanCollections(rootDir)).flatMap((collection) => collection.pages);
  const exactTurn = pages.find(
    (page) => page.conversationId === conversation.conversationId && page.turnId === turn.turnId,
  );
  const sameQuestionPages = pages.filter((page) => questionKey(page.turn.title) === questionKey(turn.title));
  const matched =
    exactTurn ||
    sameQuestionPages.find((page) => page.answerMatchId === turn.answerMatchId) ||
    sameQuestionPages[0] ||
    pages.find((page) => page.answerMatchId === turn.answerMatchId && page.answerLength >= 40);

  if (!matched) {
    return {
      question: turn.displayTitle,
      reason: "知识库中没有找到对应题目",
      status: "missing",
      stored: false,
    };
  }

  const answerMatches = matched.answerMatchId === turn.answerMatchId;
  const conflictId = hash(
    `duplicate:${questionKey(turn.title)}:${matched.turnId}:${turn.turnId}:${turn.answerMatchId}`,
    20,
  );
  const keptExistingAnswer = decisionCache.duplicateResolutions[conflictId] === "keep_existing";
  const pagePath = `/${path
    .relative(path.join(projectRoot, "src"), matched.filePath)
    .replaceAll(path.sep, "/")
    .replace(/\.md$/u, ".html")}`;

  return {
    answerMatches,
    category: matched.category,
    collectionTitle: matched.collectionTitle,
    pagePath,
    question: turn.displayTitle,
    reason: answerMatches
      ? "题目、答案和文件均已核对"
      : keptExistingAnswer
        ? "同题冲突时按你的选择保留了知识库原答案"
        : "知识库中的答案不是当前页面的最新版本",
    status: answerMatches ? "stored" : keptExistingAnswer ? "stored_existing_answer" : "outdated",
    stored: answerMatches || keptExistingAnswer,
  };
}

export async function createCollection(projectRoot, input = {}) {
  const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
  await mkdir(rootDir, { recursive: true });
  const collections = await scanCollections(rootDir);
  const collectionTitle = userCollectionTitle(input.collectionTitle);
  if (findMatchingCollection(collections, collectionTitle)) throw new Error("已存在同名或含义相同的分类");

  const category = cleanText(input.category, 40) || collectionTitle.replace(/面试题$/u, "") || "自定义分类";
  const baseName = slugify(collectionTitle);
  const usedNames = new Set(collections.map((collection) => collection.collectionId));
  let collectionId = baseName;
  let suffix = 2;
  while (usedNames.has(collectionId)) collectionId = `${baseName}-${suffix++}`;
  const collectionDir = path.join(rootDir, collectionId);
  const collection = {
    category,
    collectionDir,
    collectionId,
    collectionTitle,
    pages: [],
    samples: [],
    tags: [],
  };

  await mkdir(collectionDir, { recursive: true });
  await atomicWrite(path.join(collectionDir, "README.md"), renderConversationIndex(collection, []));
  return {
    collection: { category, collectionId, collectionTitle, questionCount: 0 },
    collections: await listCollections(projectRoot),
  };
}

export async function renameCollection(projectRoot, collectionId, input = {}) {
  const safeId = cleanText(collectionId, 100);
  if (!safeId || safeId !== path.basename(safeId) || safeId.includes("..")) throw new Error("分类 ID 无效");

  const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
  const collections = await scanCollections(rootDir);
  const collection = collections.find((item) => item.collectionId === safeId);
  if (!collection) throw new Error("要修改的分类不存在");
  const collectionTitle = userCollectionTitle(input.collectionTitle);
  const duplicate = findMatchingCollection(
    collections.filter((item) => item.collectionId !== safeId),
    collectionTitle,
  );
  if (duplicate) throw new Error("已存在同名或含义相同的分类");

  for (const page of collection.pages) {
    const content = page.content.replace(
      /^chatgptCollectionTitle:\s*.*$/m,
      `chatgptCollectionTitle: ${yamlString(collectionTitle)}`,
    );
    if (content !== page.content) await atomicWrite(page.filePath, content);
  }
  collection.collectionTitle = collectionTitle;
  const pages = collection.pages.map((page) => ({
    filePath: page.filePath,
    filename: path.basename(page.filePath),
    turn: page.turn,
  }));
  await atomicWrite(path.join(collection.collectionDir, "README.md"), renderConversationIndex(collection, pages));

  return {
    collection: {
      category: collection.category,
      collectionId: safeId,
      collectionTitle,
      questionCount: collection.pages.length,
    },
    collections: await listCollections(projectRoot),
  };
}

async function collectionForClassification(rootDir, collections, classification) {
  const existing = findMatchingCollection(collections, classification.collectionTitle);
  if (existing) return { collection: existing, created: false };

  const baseName = slugify(classification.collectionTitle);
  const usedNames = new Set(collections.map((collection) => path.basename(collection.collectionDir)));
  let directoryName = baseName;
  let suffix = 2;
  while (usedNames.has(directoryName)) directoryName = `${baseName}-${suffix++}`;
  const collectionDir = path.join(rootDir, directoryName);
  await mkdir(collectionDir, { recursive: true });
  const collection = {
    category: classification.category,
    collectionDir,
    collectionId: directoryName,
    collectionTitle: classification.collectionTitle,
    pages: [],
    samples: [],
    tags: classification.tags,
  };
  collections.push(collection);
  return { collection, created: true };
}

export async function saveConversation(projectRoot, input, options = {}) {
  const conversation = normalizePayload(input);
  const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
  await mkdir(rootDir, { recursive: true });

  const collections = await scanCollections(rootDir);
  const fixedCollection =
    conversation.classificationMode === "fixed"
      ? collections.find((collection) => collection.collectionId === conversation.fixedCollectionId) ||
        findMatchingCollection(collections, conversation.fixedCollectionTitle)
      : null;
  if (conversation.classificationMode === "fixed" && !fixedCollection) {
    throw new Error("固定分类不存在，请在扩展设置中重新选择");
  }
  const decisionCache = await loadDecisionCache(projectRoot);
  const classifier = typeof options.classifier === "function" ? { enabled: true, classify: options.classifier } : options.classifier;
  const classificationWarnings = [];
  const allPages = collections.flatMap((collection) => collection.pages);
  const existingFiles = allPages.filter((page) => page.conversationId === conversation.conversationId);
  const existingByTurn = new Map(existingFiles.map((file) => [file.turnId, file]));
  const existingByAnswer = new Map(
    existingFiles.filter((file) => file.answerId && file.answerLength >= 40).map((file) => [file.answerId, file]),
  );
  const existingByAnswerMatch = new Map(
    existingFiles.filter((file) => file.answerMatchId && file.answerLength >= 40).map((file) => [file.answerMatchId, file]),
  );
  const requestedResolutions =
    input?.duplicateResolutions && typeof input.duplicateResolutions === "object" ? input.duplicateResolutions : {};
  const pageByQuestion = new Map();
  for (const page of allPages) {
    const key = questionKey(page.turn.title);
    if (key && !pageByQuestion.has(key)) pageByQuestion.set(key, page);
  }
  const duplicateMatches = new Map();
  const conflicts = [];
  let decisionCacheChanged = false;

  for (const turn of conversation.turns) {
    if (!shouldStoreQuestion(turn.question)) continue;
    const matchedTurn =
      existingByTurn.get(turn.turnId) ||
      (turn.answer.length >= 40 ? existingByAnswer.get(turn.answerId) || existingByAnswerMatch.get(turn.answerMatchId) : null);
    if (matchedTurn) continue;

    let duplicate = pageByQuestion.get(questionKey(turn.title));
    let matchType = duplicate ? "exact" : "";
    let matchReason = "";
    if (
      !duplicate &&
      shouldStoreQuestion(turn.question) &&
      classifier?.enabled &&
      typeof classifier.findDuplicate === "function" &&
      allPages.length
    ) {
      const inferredCategory = inferTopic(`${turn.question}\n${turn.answer.slice(0, 600)}`).category;
      const candidates = allPages
        .filter((page) => questionKey(page.turn.title) !== questionKey(turn.title))
        .sort((left, right) => Number(right.category === inferredCategory) - Number(left.category === inferredCategory))
        .slice(0, 60)
        .map((page, index) => ({
          id: `q${index + 1}-${page.turnId || hash(page.filePath, 12)}`,
          page,
          question: page.turn.title,
        }));
      const candidateFingerprint = candidates.map(({ id, question }) => `${id}:${questionKey(question)}`).join("|");
      const semanticCacheKey = hash(`semantic:${questionKey(turn.title)}:${candidateFingerprint}`, 24);
      const hasCachedMatch = Object.hasOwn(decisionCache.semanticMatches, semanticCacheKey);
      let semanticResult = hasCachedMatch ? decisionCache.semanticMatches[semanticCacheKey] : null;
      if (!hasCachedMatch) {
        try {
          semanticResult = await classifier.findDuplicate({
            existingQuestions: candidates.map(({ id, question }) => ({ id, question })),
            question: turn.title,
          });
          decisionCache.semanticMatches[semanticCacheKey] = semanticResult || null;
          decisionCacheChanged = true;
        } catch (error) {
          classificationWarnings.push(error instanceof Error ? error.message : "语义重复检测失败，已继续同步");
        }
      }
      const matchedCandidate = candidates.find(({ id }) => id === semanticResult?.duplicateId);
      if (matchedCandidate) {
        duplicate = matchedCandidate.page;
        matchType = "semantic";
        matchReason = cleanText(semanticResult.reason, 160);
      }
    }
    if (!duplicate) continue;
    const sameAnswer = duplicate.answerMatchId === turn.answerMatchId || /^当前问题尚未同步/u.test(turn.answer);
    const conflictId = hash(
      `duplicate:${questionKey(turn.title)}:${duplicate.turnId}:${turn.turnId}:${turn.answerMatchId}`,
      20,
    );
    const requested = cleanText(requestedResolutions[conflictId], 30);
    const cached = cleanText(decisionCache.duplicateResolutions[conflictId], 30);
    const resolution = sameAnswer ? "keep_existing" : requested || cached;

    if (!sameAnswer && !["keep_existing", "use_new"].includes(resolution)) {
      conflicts.push({
        conflictId,
        existingAnswer: duplicate.answer.slice(0, 1_600),
        existingCollection: duplicate.collectionTitle,
        existingQuestion: duplicate.turn.title,
        matchReason,
        matchType,
        newAnswer: turn.answer.slice(0, 1_600),
        question: turn.title,
      });
      continue;
    }

    duplicateMatches.set(turn.turnId, { matchType, page: duplicate, resolution });
    if (requested && requested !== cached) {
      decisionCache.duplicateResolutions[conflictId] = requested;
      decisionCacheChanged = true;
    }
  }

  if (conflicts.length) {
    if (decisionCacheChanged) await saveDecisionCache(decisionCache);
    return {
      classificationWarnings: [...new Set(classificationWarnings)],
      conflicts,
      created: false,
      createdCount: 0,
      questionCount: existingFiles.length,
      requiresResolution: true,
      skippedCount: 0,
    };
  }

  const skippedReasons = [];
  const touchedCollections = new Map();
  const conversationPagePaths = new Set(existingFiles.map((file) => file.filePath));
  const nextOrderByDir = new Map(
    collections.map((collection) => [
      collection.collectionDir,
      collection.pages.reduce((maximum, page) => Math.max(maximum, page.turn.order), 0),
    ]),
  );
  let createdCount = 0;
  let createdCollectionCount = 0;
  let skippedCount = 0;
  let lastPageFilePath = "";

  for (const turn of conversation.turns) {
    if (!shouldStoreQuestion(turn.question)) {
      skippedCount += 1;
      skippedReasons.push("属于提示词、格式约束或非复习内容");
      continue;
    }
    let existing =
      existingByTurn.get(turn.turnId) ||
      (turn.answer.length >= 40 ? existingByAnswer.get(turn.answerId) || existingByAnswerMatch.get(turn.answerMatchId) : null);
    const duplicateMatch = existing ? null : duplicateMatches.get(turn.turnId);
    if (duplicateMatch?.resolution === "keep_existing") {
      conversationPagePaths.add(duplicateMatch.page.filePath);
      lastPageFilePath = duplicateMatch.page.filePath;
      continue;
    }
    const replacingDuplicate = duplicateMatch?.resolution === "use_new";
    if (replacingDuplicate) existing = duplicateMatch.page;
    let classification;
    let targetCollection;

    if (existing) {
      targetCollection = collections.find((collection) => collection.collectionDir === existing.collectionDir);
      classification = {
        category: existing.category || targetCollection?.category || conversation.category,
        collectionTitle: targetCollection?.collectionTitle || existing.collectionTitle || conversation.collectionTitle,
        tags: existing.tags.length ? existing.tags : conversation.tags,
        usedExisting: true,
      };
    } else {
      const decisionKey = hash(`${conversation.conversationId}:${turn.turnId}`, 24);
      const cachedDecision = decisionCache.decisions[decisionKey];
      if (cachedDecision?.shouldStore === false) {
        skippedCount += 1;
        skippedReasons.push(cleanText(cachedDecision.skipReason, 120) || "非复习内容");
        continue;
      }

      let modelResult = null;
      if (classifier?.enabled && typeof classifier.classify === "function") {
        try {
          modelResult = await classifier.classify({
            answerExcerpt: turn.answer.slice(0, 1_200),
            existingCollections: collections.map(({ category, collectionTitle, samples, tags }) => ({
              category,
              collectionTitle,
              samples,
              tags,
            })),
            question: turn.question,
          });
        } catch (error) {
          classificationWarnings.push(error instanceof Error ? error.message : "分类接口调用失败，已使用本地规则");
        }
      }
      classification = resolveQuestionClassification(turn.question, modelResult, collections, turn.answer.slice(0, 1_200));
      if (!classification.shouldStore) {
        skippedCount += 1;
        skippedReasons.push(classification.skipReason);
        decisionCache.decisions[decisionKey] = {
          shouldStore: false,
          skipReason: classification.skipReason,
          updatedAt: new Date().toISOString(),
        };
        decisionCacheChanged = true;
        continue;
      }
      if (fixedCollection) {
        classification = {
          ...classification,
          category: fixedCollection.category,
          collectionTitle: fixedCollection.collectionTitle,
          tags: [...new Set([...fixedCollection.tags, ...classification.tags])].slice(0, 8),
          usedExisting: true,
        };
        targetCollection = fixedCollection;
      } else {
        const resolvedCollection = await collectionForClassification(rootDir, collections, classification);
        targetCollection = resolvedCollection.collection;
        if (resolvedCollection.created) createdCollectionCount += 1;
      }
    }

    if (!targetCollection) throw new Error("无法确定问题所属分类");
    touchedCollections.set(targetCollection.collectionDir, targetCollection);
    const nextAvailableOrder = nextOrderByDir.get(targetCollection.collectionDir) || 0;
    const resolvedOrder = turn.explicitOrder
      ? turn.order
      : existing
        ? existing.turn.order
        : nextAvailableOrder + 1;
    nextOrderByDir.set(targetCollection.collectionDir, Math.max(nextAvailableOrder, resolvedOrder));
    const resolvedTitle = replacingDuplicate ? existing.turn.title : turn.title;
    const resolvedTurn = {
      ...turn,
      displayTitle: `${resolvedOrder}. ${resolvedTitle}`,
      order: resolvedOrder,
      title: resolvedTitle,
      turnId: turn.turnId,
    };
    const filename = existing
      ? path.basename(existing.filePath)
      : `${String(resolvedOrder).padStart(2, "0")}-${slugify(turn.title)}-${turn.turnId.slice(0, 8)}.md`;
    const filePath = existing?.filePath ?? path.join(targetCollection.collectionDir, filename);
    const inheritedRedirect =
      existing?.redirectFrom ||
      (conversation.redirectPath && turn.turnId === conversation.turns.at(-1)?.turnId ? conversation.redirectPath : "");
    const keepExistingQuestion = existing && turn.inferredQuestion && !existing.turn.inferredQuestion;
    if (!keepExistingQuestion) {
      const markdown = renderQuestionMarkdown(
        { ...conversation, ...classification },
        resolvedTurn,
        existing?.originalDate || conversation.createdAt,
        inheritedRedirect,
      );
      await atomicWrite(filePath, markdown);
    }
    if (!existing) createdCount += 1;
    conversationPagePaths.add(filePath);
    lastPageFilePath = filePath;
    if (!targetCollection.samples.includes(turn.title)) targetCollection.samples.push(turn.title);
    targetCollection.category ||= classification.category;
    targetCollection.tags = [...new Set([...targetCollection.tags, ...classification.tags])].slice(0, 8);
  }

  const refreshedCollections = [];
  for (const collection of touchedCollections.values()) {
    const refreshed = await readCollectionDirectory(collection.collectionDir);
    refreshed.collectionTitle = collection.collectionTitle;
    refreshed.category = collection.category;
    const pages = refreshed.pages.map((page) => ({
      filePath: page.filePath,
      filename: path.basename(page.filePath),
      turn: page.turn,
    }));
    await atomicWrite(path.join(collection.collectionDir, "README.md"), renderConversationIndex(refreshed, pages));
    refreshedCollections.push(refreshed);
  }

  for (const legacyFile of await findLegacyFiles(rootDir, conversation.conversationId)) {
    await unlink(legacyFile);
  }
  if (decisionCacheChanged) await saveDecisionCache(decisionCache);

  const primaryCollection = refreshedCollections[0];
  const primaryDir = primaryCollection?.collectionDir || rootDir;
  const indexPath = path.join(primaryDir, "README.md");
  const relativePath = path.relative(projectRoot, primaryDir);
  const collectionPath =
    refreshedCollections.length === 1
      ? `/${path.relative(path.join(projectRoot, "src"), primaryDir).replaceAll(path.sep, "/")}/`
      : "/interview/chatgpt/";
  const pagePath = lastPageFilePath
    ? `/${path.relative(path.join(projectRoot, "src"), lastPageFilePath).replaceAll(path.sep, "/").replace(/\.md$/u, ".html")}`
    : collectionPath;

  return {
    classificationMode:
      conversation.classificationMode === "fixed" ? "fixed" : classifier?.enabled ? "llm" : "local",
    classificationWarnings: [...new Set(classificationWarnings)],
    collections: refreshedCollections.map((collection) => collection.collectionTitle),
    collectionPath,
    created: createdCollectionCount > 0,
    createdCount,
    filePath: indexPath,
    pagePath,
    questionCount: conversationPagePaths.size,
    requiresResolution: false,
    relativePath,
    skippedCount,
    skippedReasons: [...new Set(skippedReasons)],
    title: refreshedCollections.map((collection) => collection.collectionTitle).join("、") || conversation.collectionTitle,
  };
}

export function parseLegacyMarkdown(content, redirectPath = "") {
  const metadata = (name) => content.match(new RegExp(`^${name}:\\s*["']?([^"'\\n]+)["']?$`, "m"))?.[1]?.trim() || "";
  const bodyStart = content.indexOf("\n---\n", 4);
  const body = bodyStart >= 0 ? content.slice(bodyStart + 5) : content;
  const markers = [...body.matchAll(/^## (问题|ChatGPT 回答) \d+\s*$/gm)];
  const messages = [];

  for (let index = 0; index < markers.length; index += 1) {
    const marker = markers[index];
    const start = marker.index + marker[0].length;
    const end = markers[index + 1]?.index ?? body.lastIndexOf("\n---\n");
    const segment = cleanText(body.slice(start, end > start ? end : undefined));
    if (segment) messages.push({ role: marker[1] === "问题" ? "user" : "assistant", content: segment });
  }

  return {
    conversationId: metadata("chatgptConversationId"),
    createdAt: metadata("date"),
    messages,
    redirectPath,
    sourceUrl: metadata("sourceUrl"),
    title: metadata("title"),
  };
}
