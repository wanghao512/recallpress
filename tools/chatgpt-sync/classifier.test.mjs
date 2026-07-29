import assert from "node:assert/strict";
import test from "node:test";

import { createQuestionClassifier } from "./classifier.mjs";

test("分类器使用 OpenAI 兼容请求并携带已有分类", async () => {
  let capturedUrl = "";
  let capturedOptions;
  const classifier = createQuestionClassifier({
    apiKey: "test-key",
    fetch: async (url, options) => {
      capturedUrl = url;
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content:
                  '{"shouldStore":true,"skipReason":"","action":"use_existing","collectionTitle":"RAG 面试题","category":"AI 与大模型","tags":["RAG"]}',
              },
            },
          ],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    },
  });

  const result = await classifier.classify({
    answerExcerpt: "RRF 可以融合多路排名。",
    existingCollections: [
      { category: "AI 与大模型", collectionTitle: "RAG 面试题", samples: ["什么是多路召回？"] },
    ],
    question: "RRF 是什么？",
  });
  const body = JSON.parse(capturedOptions.body);
  const prompt = body.messages[1].content;

  assert.equal(capturedUrl, "https://api.openai.com/v1/chat/completions");
  assert.equal(capturedOptions.headers.Authorization, "Bearer test-key");
  assert.equal(body.model, "gpt-4.1-mini");
  assert.ok(prompt.indexOf("existingCollections=") < prompt.indexOf("question="));
  assert.match(prompt, /RAG 面试题/);
  assert.equal(result.action, "use_existing");
});

test("语义重复检测只接受候选列表中的题目", async () => {
  let capturedOptions;
  const classifier = createQuestionClassifier({
    apiKey: "test-key",
    fetch: async (_url, options) => {
      capturedOptions = options;
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"duplicateId":"question-1","reason":"核心问题相同"}' } }],
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      );
    },
  });

  const result = await classifier.findDuplicate({
    existingQuestions: [
      { id: "question-1", question: "为什么 RAG 需要在生成前进行检索？" },
      { id: "question-2", question: "RAG 的切分策略有哪些？" },
    ],
    question: "检索增强生成为什么要先查知识库？",
  });
  const body = JSON.parse(capturedOptions.body);

  assert.equal(result.duplicateId, "question-1");
  assert.equal(body.max_tokens, 180);
  assert.match(body.messages[1].content, /可以合理共用同一个完整答案/);
});

test("连通性测试记录 OpenAI 兼容接口返回的 Token 用量", async () => {
  let recordedUsage;
  const classifier = createQuestionClassifier({
    apiKey: "test-key",
    fetch: async () =>
      new Response(
        JSON.stringify({
          choices: [{ message: { content: '{"ok":true}' } }],
          model: "provider/model-name",
          usage: { completion_tokens: 5, prompt_tokens: 12, total_tokens: 17 },
        }),
        { headers: { "Content-Type": "application/json" }, status: 200 },
      ),
    model: "provider/model-name",
    onUsage: (usage) => {
      recordedUsage = usage;
    },
  });

  const result = await classifier.testConnection();

  assert.equal(result.model, "provider/model-name");
  assert.equal(recordedUsage.operation, "connection_test");
  assert.equal(recordedUsage.promptTokens, 12);
  assert.equal(recordedUsage.completionTokens, 5);
  assert.equal(recordedUsage.totalTokens, 17);
});
