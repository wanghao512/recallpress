import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  loadApiSettings,
  loadApiUsage,
  publicApiSettings,
  recordApiUsage,
  resetApiUsage,
  saveApiSettings,
} from "./api-settings.mjs";

test("API 配置保存在本地且读取接口不会暴露密钥", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-api-settings-"));

  try {
    const saved = await saveApiSettings(projectRoot, {
      apiKey: "test-local-secret",
      baseUrl: "https://api.example.com/",
      enabled: true,
      endpoint: "/v1/chat/completions",
      model: "provider/model-name",
    });
    const loaded = await loadApiSettings(projectRoot);
    const exposed = publicApiSettings(loaded);

    assert.equal(saved.baseUrl, "https://api.example.com");
    assert.equal(loaded.apiKey, "test-local-secret");
    assert.equal(exposed.hasApiKey, true);
    assert.match(exposed.maskedApiKey, /^tes.+cret$/);
    assert.equal(Object.hasOwn(exposed, "apiKey"), false);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});

test("API 用量累计并支持清空本地统计", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-api-usage-"));

  try {
    await recordApiUsage(projectRoot, {
      completionTokens: 20,
      model: "provider/model-name",
      promptTokens: 80,
      totalTokens: 100,
    });
    await recordApiUsage(projectRoot, {
      completionTokens: 10,
      model: "provider/model-name",
      promptTokens: 40,
      totalTokens: 50,
    });
    const usage = await loadApiUsage(projectRoot);

    assert.equal(usage.requests, 2);
    assert.equal(usage.promptTokens, 120);
    assert.equal(usage.completionTokens, 30);
    assert.equal(usage.totalTokens, 150);
    assert.equal(usage.lastModel, "provider/model-name");

    const reset = await resetApiUsage(projectRoot);
    assert.equal(reset.requests, 0);
    assert.equal((await loadApiUsage(projectRoot)).totalTokens, 0);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
