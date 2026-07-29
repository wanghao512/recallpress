import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

import { classifierDefaults } from "./classifier.mjs";

const SETTINGS_VERSION = 1;
const USAGE_VERSION = 1;
let usageWriteQueue = Promise.resolve();

function clean(value, maxLength = 1_000) {
  return String(value ?? "").trim().slice(0, maxLength);
}

function envEnabled(value) {
  return !["0", "false", "off", "no"].includes(clean(value ?? "true", 20).toLowerCase());
}

function settingsPath(projectRoot) {
  return path.join(projectRoot, ".chatgpt-sync", "api-settings.json");
}

function usagePath(projectRoot) {
  return path.join(projectRoot, ".chatgpt-sync", "api-usage.json");
}

async function readJson(filePath) {
  const content = await readFile(filePath, "utf8").catch(() => "");
  if (!content) return null;
  try {
    return JSON.parse(content);
  } catch {
    return null;
  }
}

async function atomicJson(filePath, value) {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temporaryPath = `${filePath}.${process.pid}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, "utf8");
  await rename(temporaryPath, filePath);
}

function validateBaseUrl(value) {
  const baseUrl = clean(value, 1_000).replace(/\/+$/, "");
  let parsed;
  try {
    parsed = new URL(baseUrl);
  } catch {
    throw new Error("API 地址不是有效 URL");
  }
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("API 地址必须使用 HTTPS，本机地址可使用 HTTP");
  return baseUrl;
}

function validateEndpoint(value) {
  const endpoint = clean(value, 1_000);
  if (!endpoint) throw new Error("Chat Completions 路径不能为空");
  if (!endpoint.startsWith("/") && !/^https?:\/\//i.test(endpoint)) {
    throw new Error("接口路径应以 / 开头，或填写完整 URL");
  }
  return endpoint;
}

function normalizeSettings(input, current) {
  const apiKeyInput = typeof input?.apiKey === "string" ? clean(input.apiKey, 4_000) : "";
  const model = clean(input?.model ?? current.model, 300);
  if (!model) throw new Error("模型名称不能为空");
  return {
    apiKey: apiKeyInput || current.apiKey,
    baseUrl: validateBaseUrl(input?.baseUrl ?? current.baseUrl),
    enabled: input?.enabled === undefined ? current.enabled : Boolean(input.enabled),
    endpoint: validateEndpoint(input?.endpoint ?? current.endpoint),
    model,
    version: SETTINGS_VERSION,
  };
}

export async function loadApiSettings(projectRoot) {
  const stored = await readJson(settingsPath(projectRoot));
  const fallback = {
    apiKey: clean(process.env.LLM_API_KEY, 4_000),
    baseUrl: clean(process.env.LLM_BASE_URL, 1_000) || classifierDefaults.baseUrl,
    enabled: envEnabled(process.env.LLM_CLASSIFIER_ENABLED),
    endpoint: clean(process.env.LLM_CHAT_COMPLETIONS_PATH, 1_000) || classifierDefaults.endpoint,
    model: clean(process.env.LLM_MODEL, 300) || classifierDefaults.model,
  };
  return normalizeSettings(stored || {}, fallback);
}

export async function resolveApiSettings(projectRoot, input = {}) {
  return normalizeSettings(input, await loadApiSettings(projectRoot));
}

export async function saveApiSettings(projectRoot, input = {}) {
  const settings = await resolveApiSettings(projectRoot, input);
  await atomicJson(settingsPath(projectRoot), settings);
  return settings;
}

export function publicApiSettings(settings) {
  const apiKey = clean(settings?.apiKey, 4_000);
  return {
    baseUrl: settings.baseUrl,
    enabled: settings.enabled,
    endpoint: settings.endpoint,
    hasApiKey: Boolean(apiKey),
    maskedApiKey: apiKey ? `${apiKey.slice(0, 3)}••••${apiKey.slice(-4)}` : "",
    model: settings.model,
  };
}

function emptyUsage() {
  return {
    completionTokens: 0,
    lastModel: "",
    lastUsedAt: "",
    promptTokens: 0,
    requests: 0,
    totalTokens: 0,
    version: USAGE_VERSION,
  };
}

export async function loadApiUsage(projectRoot) {
  const stored = await readJson(usagePath(projectRoot));
  const fallback = emptyUsage();
  if (!stored || typeof stored !== "object") return fallback;
  return {
    completionTokens: Number(stored.completionTokens) || 0,
    lastModel: clean(stored.lastModel, 300),
    lastUsedAt: clean(stored.lastUsedAt, 100),
    promptTokens: Number(stored.promptTokens) || 0,
    requests: Number(stored.requests) || 0,
    totalTokens: Number(stored.totalTokens) || 0,
    version: USAGE_VERSION,
  };
}

export async function recordApiUsage(projectRoot, input = {}) {
  usageWriteQueue = usageWriteQueue.then(async () => {
    const usage = await loadApiUsage(projectRoot);
    const promptTokens = Number(input.promptTokens) || 0;
    const completionTokens = Number(input.completionTokens) || 0;
    const totalTokens = Number(input.totalTokens) || promptTokens + completionTokens;
    await atomicJson(usagePath(projectRoot), {
      completionTokens: usage.completionTokens + completionTokens,
      lastModel: clean(input.model, 300) || usage.lastModel,
      lastUsedAt: new Date().toISOString(),
      promptTokens: usage.promptTokens + promptTokens,
      requests: usage.requests + 1,
      totalTokens: usage.totalTokens + totalTokens,
      version: USAGE_VERSION,
    });
  });
  await usageWriteQueue;
  return loadApiUsage(projectRoot);
}

export async function resetApiUsage(projectRoot) {
  const usage = emptyUsage();
  await atomicJson(usagePath(projectRoot), usage);
  return usage;
}
