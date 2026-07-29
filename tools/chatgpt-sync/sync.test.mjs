import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createCollection,
  inferTopic,
  inferCollectionTitle,
  listCollections,
  normalizePayload,
  pairTurns,
  parseLegacyMarkdown,
  questionKey,
  renderQuestionMarkdown,
  renameCollection,
  resolveQuestionClassification,
  saveConversation,
  selectMessagesForSync,
  shouldStoreQuestion,
  slugify,
  verifyLastQuestion,
} from "./sync.mjs";

const sample = {
  title: "TCP 三次握手",
  sourceUrl: "https://chatgpt.com/c/12345678-abcd",
  conversationId: "12345678-abcd",
  createdAt: "2026-07-28T08:00:00.000Z",
  messages: [
    { role: "user", content: "请解释 TCP 三次握手" },
    { role: "assistant", content: "# 核心结论\n\n客户端和服务端通过 SYN、SYN-ACK、ACK 建立连接。\n\n```text\nSYN -> SYN-ACK -> ACK\n```" },
  ],
};

test("slugify 保留中文并清理文件名", () => {
  assert.equal(slugify("  TCP 三次握手？ "), "tcp-三次握手");
  assert.equal(questionKey("13. 什么是 RAG？"), questionKey("什么是RAG?"));
  assert.notEqual(questionKey("什么是 RAG？"), questionKey("RAG 有哪些优点？"));
});

test("根据问题内容推断学习分类", () => {
  assert.deepEqual(inferTopic("TCP 的拥塞控制"), { category: "计算机网络", tags: ["计算机网络"] });
  assert.deepEqual(inferTopic("13. 什么是多路召回，RAG 中如何实现？"), {
    category: "AI 与大模型",
    tags: ["AI", "大模型"],
  });
  assert.equal(inferCollectionTitle("13. 什么是多路召回，RAG 中如何实现？", "AI 与大模型"), "RAG 面试题");
});

test("先过滤提示词，再优先复用已有分类", () => {
  assert.equal(shouldStoreQuestion("从现在开始，后续回答都使用 JSON 格式。"), false);
  assert.equal(
    shouldStoreQuestion("我希望你后面的回答都是先模拟一个面试对话，然后做一个简要回答，再去做详细的解析。"),
    false,
  );
  assert.equal(shouldStoreQuestion("请解释数据库 MVCC 的原理"), true);

  const guarded = resolveQuestionClassification(
    "我希望你后面的回答都是先模拟一个面试对话，然后做一个简要回答，再去做详细的解析。",
    {
      action: "create_new",
      category: "综合复习",
      collectionTitle: "综合面试题",
      shouldStore: true,
      tags: ["综合"],
    },
  );
  assert.equal(guarded.shouldStore, false);

  const classification = resolveQuestionClassification(
    "多路召回为什么常用 RRF？",
    {
      action: "use_existing",
      category: "AI 与大模型",
      collectionTitle: "RAG 面试题",
      shouldStore: true,
      tags: ["RAG"],
    },
    [{ category: "AI 与大模型", collectionTitle: "RAG 面试题", samples: ["什么是多路召回？"], tags: ["RAG"] }],
  );

  assert.equal(classification.shouldStore, true);
  assert.equal(classification.usedExisting, true);
  assert.equal(classification.collectionTitle, "RAG 面试题");
});

test("将对话配对为一问一答并保留显式题号", () => {
  const turns = pairTurns([
    { role: "user", content: "13. 什么是多路召回？" },
    { role: "assistant", content: "多种检索策略并行召回。" },
  ]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].order, 13);
  assert.equal(turns[0].displayTitle, "13. 什么是多路召回？");
});

test("同步范围可以只保留最后一组完整问答", () => {
  const messages = [
    { role: "user", content: "第一题" },
    { role: "assistant", content: "第一题答案" },
    { role: "user", content: "第二题" },
    { role: "assistant", content: "第二题答案" },
  ];

  assert.deepEqual(selectMessagesForSync(messages, "last"), messages.slice(2));
  assert.deepEqual(selectMessagesForSync(messages, "conversation"), messages);
  assert.deepEqual(selectMessagesForSync([...messages, { role: "user", content: "尚未回答" }], "last"), [
    { role: "user", content: "尚未回答" },
  ]);

  const normalized = normalizePayload({ ...sample, messages, syncScope: "last" });
  assert.equal(normalized.syncScope, "last");
  assert.equal(normalized.turns.length, 1);
  assert.equal(normalized.turns[0].question, "第二题");
});

test("缺失用户消息时标记推断问题", () => {
  const turns = pairTurns([{ role: "assistant", content: "# 向量检索和关键词检索的核心区别\n\n向量检索关注语义。" }]);

  assert.equal(turns.length, 1);
  assert.equal(turns[0].inferredQuestion, true);
  assert.match(turns[0].displayTitle, /向量检索和关键词检索/);
});

test("忽略 ChatGPT 的临时思考占位文字", () => {
  assert.throws(
    () => normalizePayload({ ...sample, messages: [{ role: "assistant", content: "正在思考" }] }),
    /没有找到可同步的对话内容/,
  );
  assert.throws(
    () => normalizePayload({ ...sample, messages: [{ role: "assistant", content: "正在分析 1 幅图片" }] }),
    /没有找到可同步的对话内容/,
  );
});

test("每个问题渲染为独立 Markdown 页面", () => {
  const conversation = normalizePayload(sample);
  const markdown = renderQuestionMarkdown(conversation, conversation.turns[0]);

  assert.equal(conversation.category, "计算机网络");
  assert.match(markdown, /date: 2026-07-28/);
  assert.match(markdown, /pageClass: interview-note/);
  assert.match(markdown, /<div class="interview-question-card">/);
  assert.doesNotMatch(markdown, /^# /m);
  assert.match(markdown, /## 参考答案/);
  assert.match(markdown, /### 核心结论/);
  assert.match(markdown, /```text\nSYN -> SYN-ACK -> ACK/);
  assert.match(markdown, /chatgptConversationId: "12345678-abcd"/);
  assert.match(markdown, /comment: false\neditLink: false/);
});

test("题目卡片中的 LaTeX 公式会渲染为 KaTeX", () => {
  const conversation = normalizePayload({
    ...sample,
    messages: [
      { role: "user", content: "为什么除以 (\\sqrt{d_k})，而不是除以 (d_k)？" },
      { role: "assistant", content: "因为点积的标准差随 $\\sqrt{d_k}$ 增长。" },
    ],
  });
  const markdown = renderQuestionMarkdown(conversation, conversation.turns[0]);
  const questionCard = markdown.match(/<div class="interview-question-card">[\s\S]*?<\/div>/)?.[0] || "";

  assert.match(conversation.turns[0].displayTitle, /√dₖ/);
  assert.doesNotMatch(conversation.turns[0].displayTitle, /\\sqrt/);
  assert.match(questionCard, /class="katex"/);
  assert.doesNotMatch(questionCard, /\(\\sqrt\{d_k\}\)/);
});

test("可以只读核验最后一道问题是否正常存储", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-verify-test-"));

  try {
    const missing = await verifyLastQuestion(projectRoot, sample);
    assert.equal(missing.status, "missing");
    assert.equal(missing.stored, false);

    await saveConversation(projectRoot, sample);
    const stored = await verifyLastQuestion(projectRoot, sample);
    assert.equal(stored.status, "stored");
    assert.equal(stored.stored, true);
    assert.equal(stored.answerMatches, true);
    assert.equal(stored.collectionTitle, "计算机网络面试题");
    assert.match(stored.pagePath, /^\/interview\/chatgpt\/.+\.html$/);

    const skipped = await verifyLastQuestion(projectRoot, {
      ...sample,
      conversationId: "format-instruction",
      messages: [
        { role: "user", content: "从现在开始，后续回答都使用 JSON 格式。" },
        { role: "assistant", content: "好的。" },
      ],
    });
    assert.equal(skipped.status, "skipped");
    assert.equal(skipped.stored, false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("重复同步复用已有问题页并只新增新问题", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-test-"));

  try {
    const first = await saveConversation(projectRoot, sample);
    const second = await saveConversation(projectRoot, {
      ...sample,
      messages: [
        ...sample.messages,
        { role: "user", content: "那四次挥手呢？" },
        { role: "assistant", content: "TCP 连接通常经过四次挥手关闭。" },
      ],
    });
    const conversationDir = path.dirname(first.filePath);
    const entries = await readdir(conversationDir);
    const firstQuestionPath = path.join(conversationDir, entries.find((file) => file !== "README.md" && file.endsWith(".md")));
    const firstQuestion = await readFile(firstQuestionPath, "utf8");
    const index = await readFile(first.filePath, "utf8");

    assert.equal(first.created, true);
    assert.equal(first.questionCount, 1);
    assert.equal(second.created, false);
    assert.equal(second.questionCount, 2);
    assert.equal(path.dirname(second.filePath), conversationDir);
    assert.equal(entries.filter((file) => file.endsWith(".md")).length, 3);
    assert.match(firstQuestion, /请解释 TCP 三次握手/);
    assert.match(index, /那四次挥手呢/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("局部同步不会删除页面中暂时不可见的旧问题", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-partial-test-"));
  const twoQuestions = {
    ...sample,
    messages: [
      ...sample.messages,
      { role: "user", content: "那四次挥手呢？" },
      { role: "assistant", content: "TCP 连接通常经过四次挥手关闭。" },
    ],
  };

  try {
    const first = await saveConversation(projectRoot, twoQuestions);
    const second = await saveConversation(projectRoot, {
      ...sample,
      messages: twoQuestions.messages.slice(2),
    });
    const entries = await readdir(path.dirname(first.filePath));

    assert.equal(second.questionCount, 2);
    assert.equal(entries.filter((file) => file.endsWith(".md")).length, 3);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("问题文本缺失时通过相同回答复用已有问题页", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-answer-test-"));

  try {
    const first = await saveConversation(projectRoot, sample);
    const second = await saveConversation(projectRoot, {
      ...sample,
      messages: [sample.messages[1]],
    });
    const entries = await readdir(path.dirname(first.filePath));
    const questionPage = await readFile(
      path.join(path.dirname(first.filePath), entries.find((file) => file !== "README.md" && file.endsWith(".md"))),
      "utf8",
    );

    assert.equal(second.questionCount, 1);
    assert.equal(entries.filter((file) => file.endsWith(".md")).length, 2);
    assert.match(questionPage, /请解释 TCP 三次握手/);
    assert.doesNotMatch(questionPage, /interview-inference-note/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("使用 ChatGPT 消息 ID 合并后来补全的问题", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-message-id-test-"));
  const assistant = {
    role: "assistant",
    messageId: "assistant-message-1",
    content: "多路召回会并行使用多种检索策略，并将候选结果合并后重新排序。",
  };

  try {
    const first = await saveConversation(projectRoot, { ...sample, messages: [assistant] });
    const second = await saveConversation(projectRoot, {
      ...sample,
      messages: [
        { role: "user", messageId: "user-message-1", content: "13. 什么是多路召回？" },
        { ...assistant, content: `${assistant.content}\n还可以使用 RRF 进行排名融合。` },
      ],
    });
    const entries = await readdir(path.dirname(first.filePath));
    const questionPage = await readFile(
      path.join(path.dirname(first.filePath), entries.find((file) => file !== "README.md" && file.endsWith(".md"))),
      "utf8",
    );

    assert.equal(second.questionCount, 1);
    assert.equal(entries.filter((file) => file.endsWith(".md")).length, 2);
    assert.match(questionPage, /13\. 什么是多路召回/);
    assert.doesNotMatch(questionPage, /interview-inference-note/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("无明确题号的新问题接在当前最大题号之后", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-order-test-"));

  try {
    const result = await saveConversation(projectRoot, {
      ...sample,
      messages: [
        { role: "user", content: "13. 什么是多路召回？" },
        { role: "assistant", content: "多路召回会并行使用多种检索策略。" },
        { role: "user", content: "RAG 检索优化策略有哪些？" },
        { role: "assistant", content: "可以从召回、融合和精排三个阶段优化。" },
      ],
    });
    const files = (await readdir(path.dirname(result.filePath))).filter((file) => file !== "README.md" && file.endsWith(".md"));
    const pages = await Promise.all(files.map((file) => readFile(path.join(path.dirname(result.filePath), file), "utf8")));

    assert.ok(pages.some((page) => /^title: "13\. 什么是多路召回？"$/m.test(page)));
    assert.ok(pages.some((page) => /^title: "14\. RAG 检索优化策略有哪些？"$/m.test(page)));
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("固定分类模式把新问题写入用户指定的现有分类", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-fixed-collection-test-"));
  const ragPayload = {
    ...sample,
    conversationId: "fixed-collection-rag",
    sourceUrl: "https://chatgpt.com/c/fixed-collection-rag",
    messages: [
      { role: "user", content: "什么是 RAG？" },
      { role: "assistant", content: "RAG 会检索外部知识并将相关内容提供给模型生成答案。" },
    ],
  };
  const javaPayload = {
    ...sample,
    classificationMode: "fixed",
    conversationId: "fixed-collection-java",
    fixedCollectionId: "rag-面试题",
    fixedCollectionTitle: "RAG 面试题",
    sourceUrl: "https://chatgpt.com/c/fixed-collection-java",
    messages: [
      { role: "user", content: "Java 的 HashMap 原理是什么？" },
      { role: "assistant", content: "HashMap 基于数组、链表和红黑树组织键值对。" },
    ],
  };

  try {
    const first = await saveConversation(projectRoot, ragPayload);
    const fixed = await saveConversation(projectRoot, javaPayload, {
      classifier: async () => ({
        action: "create_new",
        category: "Java",
        collectionTitle: "Java 面试题",
        shouldStore: true,
        tags: ["Java"],
      }),
    });
    const collections = await listCollections(projectRoot);
    const pageName = (await readdir(path.dirname(fixed.filePath))).find(
      (filename) => filename !== "README.md" && filename.includes("hashmap"),
    );
    const page = await readFile(path.join(path.dirname(fixed.filePath), pageName), "utf8");

    assert.equal(path.dirname(fixed.filePath), path.dirname(first.filePath));
    assert.equal(fixed.classificationMode, "fixed");
    assert.deepEqual(collections, [
      {
        category: "AI 与大模型",
        collectionId: "rag-面试题",
        collectionTitle: "RAG 面试题",
        questionCount: 2,
      },
    ]);
    assert.match(page, /Java 的 HashMap 原理是什么/);
    assert.match(page, /category:\n  - "AI 与大模型"/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("新建和重命名分类时保持稳定 ID 与文章 URL", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-manage-collection-test-"));

  try {
    const created = await createCollection(projectRoot, { collectionTitle: "系统设计专题" });
    const collectionId = created.collection.collectionId;
    const payload = {
      ...sample,
      classificationMode: "fixed",
      conversationId: "managed-collection-question",
      fixedCollectionId: collectionId,
      fixedCollectionTitle: "系统设计专题",
      sourceUrl: "https://chatgpt.com/c/managed-collection-question",
      messages: [
        { role: "user", content: "如何设计一个短链接系统？" },
        { role: "assistant", content: "短链接系统需要考虑编码、存储、缓存、跳转和高可用设计。" },
      ],
    };
    const saved = await saveConversation(projectRoot, payload);
    const collectionDir = path.dirname(saved.filePath);
    const pageName = (await readdir(collectionDir)).find(
      (filename) => filename !== "README.md" && filename.endsWith(".md"),
    );
    const pagePath = path.join(collectionDir, pageName);
    const renamed = await renameCollection(projectRoot, collectionId, { collectionTitle: "架构设计题库" });
    const page = await readFile(pagePath, "utf8");
    const index = await readFile(path.join(collectionDir, "README.md"), "utf8");

    assert.equal(renamed.collection.collectionId, collectionId);
    assert.equal(path.basename(collectionDir), collectionId);
    assert.match(page, /chatgptCollectionTitle: "架构设计题库"/);
    assert.match(index, /title: "架构设计题库"/);
    assert.equal(
      renamed.collections.find((collection) => collection.collectionId === collectionId)?.collectionTitle,
      "架构设计题库",
    );
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("本地先拦截系统提示词，避免无效调用分类接口", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-filter-test-"));
  let classifierCalls = 0;
  const classifier = async ({ question }) => {
    classifierCalls += 1;
    if (question.includes("后续回答")) {
      return { shouldStore: false, skipReason: "后续回答格式约束" };
    }
    return {
      action: "create_new",
      category: "数据库",
      collectionTitle: "数据库面试题",
      shouldStore: true,
      tags: ["MySQL"],
    };
  };
  const payload = {
    ...sample,
    conversationId: "filter-conversation",
    messages: [
      { role: "user", messageId: "prompt-1", content: "从现在开始，后续回答都使用固定格式。" },
      { role: "assistant", messageId: "answer-1", content: "好的。" },
      { role: "user", messageId: "question-1", content: "MySQL 的 MVCC 是什么？" },
      { role: "assistant", messageId: "answer-2", content: "MVCC 通过多版本并发控制减少读写冲突。" },
    ],
  };

  try {
    const first = await saveConversation(projectRoot, payload, { classifier });
    const callsAfterFirstSave = classifierCalls;
    const second = await saveConversation(projectRoot, payload, { classifier });
    const index = await readFile(first.filePath, "utf8");

    assert.equal(first.questionCount, 1);
    assert.equal(first.skippedCount, 1);
    assert.equal(callsAfterFirstSave, 1);
    assert.equal(classifierCalls, callsAfterFirstSave);
    assert.equal(second.skippedCount, 1);
    assert.match(index, /title: "数据库面试题"/);
    assert.doesNotMatch(index, /后续回答都使用固定格式/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("回答流程约束由本地保险直接拒绝，不依赖分类接口", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-fallback-filter-test-"));
  const payload = {
    ...sample,
    conversationId: "fallback-filter-conversation",
    messages: [
      {
        role: "user",
        messageId: "format-prompt",
        content: "我希望你后面的回答都是先模拟一个面试对话，然后做一个简要回答，再去做详细的解析。类似于下面这样。",
      },
      { role: "assistant", messageId: "analysis-placeholder", content: "正在分析 1 幅图片" },
    ],
  };

  try {
    const result = await saveConversation(projectRoot, payload, {
      classifier: async () => {
        throw new Error("模拟接口暂时不可用");
      },
    });
    const entries = await readdir(path.join(projectRoot, "src", "interview", "chatgpt"));

    assert.equal(result.questionCount, 0);
    assert.equal(result.skippedCount, 1);
    assert.equal(result.classificationWarnings.length, 0);
    assert.deepEqual(entries, []);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("格式提示词不能通过答案匹配覆盖已有技术题", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-existing-title-guard-test-"));
  const technicalAnswer =
    "MCP 是模型上下文协议，Agent Skill 是描述任务执行方法的能力包，二者可以组合使用但并不处于同一层级。";
  const correctPayload = {
    ...sample,
    conversationId: "existing-title-guard",
    sourceUrl: "https://chatgpt.com/c/existing-title-guard",
    messages: [
      { role: "user", messageId: "correct-question", content: "MCP 和 Agent Skill 有什么区别？" },
      { role: "assistant", messageId: "correct-answer", content: technicalAnswer },
    ],
  };
  const mismatchedPayload = {
    ...correctPayload,
    messages: [
      {
        role: "user",
        messageId: "format-prompt",
        content: "我希望你后面的回答都是先模拟一个面试对话，然后做一个简要回答，再去做详细的解析。",
      },
      { role: "assistant", messageId: "mismatched-answer", content: technicalAnswer },
    ],
  };

  try {
    const first = await saveConversation(projectRoot, correctPayload);
    const pageName = (await readdir(path.dirname(first.filePath))).find(
      (filename) => filename !== "README.md" && filename.endsWith(".md"),
    );
    const pagePath = path.join(path.dirname(first.filePath), pageName);
    const before = await readFile(pagePath, "utf8");
    const second = await saveConversation(projectRoot, mismatchedPayload);
    const after = await readFile(pagePath, "utf8");

    assert.equal(second.skippedCount, 1);
    assert.equal(after, before);
    assert.match(after, /MCP 和 Agent Skill 有什么区别/);
    assert.doesNotMatch(after, /我希望你后面的回答/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("同题答案不同时先暂停写入，并按用户选择保留或替换", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-duplicate-answer-test-"));
  const firstPayload = {
    ...sample,
    conversationId: "duplicate-answer-a",
    messages: [
      { role: "user", messageId: "question-a", content: "什么是 RAG？" },
      { role: "assistant", messageId: "answer-a", content: "旧答案：RAG 会先检索外部知识，再让模型结合上下文生成回答。" },
    ],
  };
  const secondPayload = {
    ...sample,
    conversationId: "duplicate-answer-b",
    sourceUrl: "https://chatgpt.com/c/duplicate-answer-b",
    messages: [
      { role: "user", messageId: "question-b", content: "什么是RAG?" },
      { role: "assistant", messageId: "answer-b", content: "新答案：RAG 包含检索、上下文构建和生成三个主要阶段。" },
    ],
  };

  try {
    const first = await saveConversation(projectRoot, firstPayload);
    const conflict = await saveConversation(projectRoot, secondPayload);
    const originalPage = (await readdir(path.dirname(first.filePath))).find(
      (filename) => filename !== "README.md" && filename.endsWith(".md"),
    );
    const originalPagePath = path.join(path.dirname(first.filePath), originalPage);
    const beforeResolution = await readFile(originalPagePath, "utf8");

    assert.equal(conflict.requiresResolution, true);
    assert.equal(conflict.conflicts.length, 1);
    assert.match(conflict.conflicts[0].existingAnswer, /旧答案/);
    assert.match(conflict.conflicts[0].newAnswer, /新答案/);
    assert.doesNotMatch(beforeResolution, /新答案/);

    const replaced = await saveConversation(projectRoot, {
      ...secondPayload,
      duplicateResolutions: { [conflict.conflicts[0].conflictId]: "use_new" },
    });
    const afterReplacement = await readFile(originalPagePath, "utf8");
    const markdownPages = (await readdir(path.dirname(first.filePath))).filter(
      (filename) => filename !== "README.md" && filename.endsWith(".md"),
    );

    assert.equal(replaced.requiresResolution, false);
    assert.equal(markdownPages.length, 1);
    assert.match(afterReplacement, /新答案/);
    assert.doesNotMatch(afterReplacement, /旧答案/);
    assert.match(afterReplacement, /chatgptConversationId: "duplicate-answer-b"/);
    assert.match(afterReplacement, /sourceUrl: "https:\/\/chatgpt.com\/c\/duplicate-answer-b"/);

    const thirdPayload = {
      ...secondPayload,
      conversationId: "duplicate-answer-c",
      sourceUrl: "https://chatgpt.com/c/duplicate-answer-c",
      messages: [
        { role: "user", messageId: "question-c", content: "什么是 RAG？" },
        { role: "assistant", messageId: "answer-c", content: "第三个答案：只介绍检索增强生成的定义。" },
      ],
    };
    const keepConflict = await saveConversation(projectRoot, thirdPayload);
    await saveConversation(projectRoot, {
      ...thirdPayload,
      duplicateResolutions: { [keepConflict.conflicts[0].conflictId]: "keep_existing" },
    });
    const cachedKeep = await saveConversation(projectRoot, thirdPayload);
    const afterKeep = await readFile(originalPagePath, "utf8");

    assert.equal(cachedKeep.requiresResolution, false);
    assert.match(afterKeep, /新答案/);
    assert.doesNotMatch(afterKeep, /第三个答案/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("语义相同但措辞不同的问题复用现有冲突选择流程", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-semantic-duplicate-test-"));
  const firstPayload = {
    ...sample,
    conversationId: "semantic-duplicate-a",
    messages: [
      { role: "user", messageId: "semantic-question-a", content: "为什么 RAG 需要在生成答案前进行检索？" },
      { role: "assistant", messageId: "semantic-answer-a", content: "旧答案：检索可以为模型补充外部知识并降低幻觉。" },
    ],
  };
  const secondPayload = {
    ...sample,
    conversationId: "semantic-duplicate-b",
    sourceUrl: "https://chatgpt.com/c/semantic-duplicate-b",
    messages: [
      { role: "user", messageId: "semantic-question-b", content: "检索增强生成为什么要先查询知识库？" },
      { role: "assistant", messageId: "semantic-answer-b", content: "新答案：先检索能让回答基于可更新的外部资料。" },
    ],
  };
  const classifier = {
    enabled: true,
    async classify() {
      throw new Error("语义重复题不应再次调用分类接口");
    },
    async findDuplicate({ existingQuestions }) {
      return { duplicateId: existingQuestions[0].id, reason: "两者都在询问 RAG 为什么需要先检索" };
    },
  };

  try {
    const first = await saveConversation(projectRoot, firstPayload);
    const conflict = await saveConversation(projectRoot, secondPayload, { classifier });

    assert.equal(conflict.requiresResolution, true);
    assert.equal(conflict.conflicts[0].matchType, "semantic");
    assert.match(conflict.conflicts[0].existingQuestion, /为什么 RAG/);

    const replaced = await saveConversation(
      projectRoot,
      {
        ...secondPayload,
        duplicateResolutions: { [conflict.conflicts[0].conflictId]: "use_new" },
      },
      { classifier },
    );
    const markdownPages = (await readdir(path.dirname(first.filePath))).filter(
      (filename) => filename !== "README.md" && filename.endsWith(".md"),
    );
    const page = await readFile(path.join(path.dirname(first.filePath), markdownPages[0]), "utf8");

    assert.equal(markdownPages.length, 1);
    assert.match(page, /新答案/);
    assert.match(replaced.pagePath, /\.html$/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("可以把旧的长文格式解析回原始对话", () => {
  const payload = parseLegacyMarkdown(`---
title: "旧笔记"
date: 2026-07-28
sourceUrl: "https://chatgpt.com/c/legacy-id"
chatgptConversationId: "legacy-id"
---

# 旧笔记

## ChatGPT 回答 1

向量检索关注语义。

## 问题 2

13. 什么是多路召回？

## ChatGPT 回答 2

多路召回并行使用多种检索策略。

---

[打开原始 ChatGPT 对话](https://chatgpt.com/c/legacy-id)
`);

  assert.equal(payload.messages.length, 3);
  assert.equal(payload.messages[0].role, "assistant");
  assert.equal(payload.messages[1].content, "13. 什么是多路召回？");
});
