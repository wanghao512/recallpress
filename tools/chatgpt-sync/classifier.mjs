import { readFile } from "node:fs/promises";
import path from "node:path";

const DEFAULT_BASE_URL = "https://api.openai.com";
const DEFAULT_ENDPOINT = "/v1/chat/completions";
const DEFAULT_MODEL = "gpt-4.1-mini";

function clean(value, maxLength = 200) {
  return String(value ?? "").replace(/\r\n?/g, "\n").trim().slice(0, maxLength);
}

function unquote(value) {
  const text = value.trim();
  if ((text.startsWith('"') && text.endsWith('"')) || (text.startsWith("'") && text.endsWith("'"))) {
    return text.slice(1, -1);
  }
  return text;
}

export async function loadLocalEnv(projectRoot) {
  for (const filename of [".env.local", ".env"]) {
    const content = await readFile(path.join(projectRoot, filename), "utf8").catch(() => "");
    for (const rawLine of content.split("\n")) {
      const line = rawLine.trim();
      if (!line || line.startsWith("#")) continue;
      const separator = line.indexOf("=");
      if (separator <= 0) continue;
      const key = line.slice(0, separator).trim();
      if (!/^[A-Z_][A-Z0-9_]*$/i.test(key) || process.env[key] !== undefined) continue;
      process.env[key] = unquote(line.slice(separator + 1));
    }
  }
}

function completionUrl(baseUrl, endpoint) {
  if (/^https?:\/\//i.test(endpoint)) return endpoint;
  return `${baseUrl.replace(/\/+$/, "")}/${endpoint.replace(/^\/+/, "")}`;
}

function parseModelJson(content) {
  const text = Array.isArray(content)
    ? content.map((part) => (typeof part === "string" ? part : part?.text || "")).join("")
    : String(content ?? "");
  const unfenced = text.replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/i, "").trim();
  const start = unfenced.indexOf("{");
  const end = unfenced.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("分类模型没有返回 JSON 对象");
  return JSON.parse(unfenced.slice(start, end + 1));
}

function promptFor(question, answerExcerpt, existingCollections) {
  const collections = existingCollections.map((collection) => ({
    title: collection.collectionTitle,
    category: collection.category,
    samples: collection.samples.slice(0, 5),
  }));

  return [
    "你是个人学习与面试知识库的收录判断与分类器。只判断一个用户消息，不回答消息本身。",
    "必须遵循以下顺序：",
    "1. 先判断是否值得收录。可复用的技术知识、面试问题、项目复盘问题应收录，即使使用了命令式措辞。",
    "2. 纯系统提示词、角色设定、对后续回答的格式/语言/长度/回答流程约束、寒暄、致谢、催促、页面操作指令不收录。附带的示例或截图若只用于说明回答格式，仍然不收录。若格式要求和实际技术问题同时存在，应收录并按技术问题分类。",
    "3. 值得收录时，逐一查看 existingCollections 的分类名、上级分类和题目样例。",
    "4. 只要现有分类语义上合适，就必须复用，并原样返回它的 title。",
    "5. 只有全部现有分类都不合适时，才允许 create_new。新分类应稳定、通用，不能为单道题创建过细分类。",
    "6. collectionTitle 使用“主题 + 面试题”，category 是更宽泛的上级领域，tags 为 1 到 4 个短标签。",
    "7. 只返回 JSON，不要 Markdown，不要解释。",
    "JSON 格式：",
    '{"shouldStore":true,"skipReason":"不收录时的简短原因","action":"use_existing|create_new","collectionTitle":"分类名","category":"上级领域","tags":["标签"]}',
    `existingCollections=${JSON.stringify(collections)}`,
    `question=${JSON.stringify(clean(question, 2_000))}`,
    `answerExcerpt=${JSON.stringify(clean(answerExcerpt, 1_200))}`,
  ].join("\n");
}

function duplicatePromptFor(question, existingQuestions) {
  return [
    "你是知识库的严格重复题检测器，不回答问题本身。",
    "判断新问题是否与候选中的某一道题表达了相同的核心问题，并且可以合理共用同一个完整答案。",
    "仅仅主题相关、上下游关系、一个更宽泛或更具体、问题包含部分重叠，都不算重复。拿不准时必须判定为不重复。",
    "只返回 JSON，不要 Markdown，不要解释。",
    'JSON 格式：{"duplicateId":"候选 id；不重复时为空字符串","reason":"简短理由"}',
    `newQuestion=${JSON.stringify(clean(question, 2_000))}`,
    `candidates=${JSON.stringify(existingQuestions.map(({ id, question: candidateQuestion }) => ({ id, question: clean(candidateQuestion, 300) })))}`,
  ].join("\n");
}

export function createQuestionClassifier(options = {}) {
  const apiKey = clean(options.apiKey ?? process.env.LLM_API_KEY, 4_000);
  const baseUrl = clean(options.baseUrl ?? process.env.LLM_BASE_URL ?? DEFAULT_BASE_URL, 1_000);
  const endpoint = clean(
    options.endpoint ?? process.env.LLM_CHAT_COMPLETIONS_PATH ?? DEFAULT_ENDPOINT,
    1_000,
  );
  const model = clean(options.model ?? process.env.LLM_MODEL ?? DEFAULT_MODEL, 300);
  const request = options.fetch ?? globalThis.fetch;
  const onUsage = typeof options.onUsage === "function" ? options.onUsage : null;
  const enabledSetting = clean(
    options.enabled ?? process.env.LLM_CLASSIFIER_ENABLED ?? "true",
    20,
  ).toLowerCase();
  const enabled = Boolean(apiKey) && !["0", "false", "off", "no"].includes(enabledSetting);

  async function completeJson(prompt, systemMessage, maxTokens, operation) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 25_000);
    let response;
    try {
      response = await request(completionUrl(baseUrl, endpoint), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model,
          messages: [
            { role: "system", content: systemMessage },
            { role: "user", content: prompt },
          ],
          temperature: 0,
          max_tokens: maxTokens,
        }),
        signal: controller.signal,
      });
    } finally {
      clearTimeout(timeout);
    }

    const body = await response.json().catch(() => ({}));
    if (!response.ok) {
      const detail = clean(body?.error?.message || body?.detail || `HTTP ${response.status}`, 300);
      throw new Error(`模型接口调用失败：${detail}`);
    }
    if (onUsage) {
      const promptTokens = Number(body?.usage?.prompt_tokens ?? body?.usage?.input_tokens) || 0;
      const completionTokens = Number(body?.usage?.completion_tokens ?? body?.usage?.output_tokens) || 0;
      await Promise.resolve(
        onUsage({
          completionTokens,
          model: clean(body?.model, 300) || model,
          operation,
          promptTokens,
          totalTokens: Number(body?.usage?.total_tokens) || promptTokens + completionTokens,
        }),
      ).catch(() => {});
    }
    return parseModelJson(body?.choices?.[0]?.message?.content);
  }

  return {
    baseUrl,
    enabled,
    model,
    reason: enabled ? "" : apiKey ? "分类接口已关闭" : "未配置 LLM_API_KEY",
    async testConnection() {
      if (!enabled) throw new Error(apiKey ? "智能分类当前已关闭" : "请先填写 API Key");
      const startedAt = Date.now();
      const result = await completeJson(
        '请只返回 {"ok":true}。',
        "你是 API 连通性检查器，只输出 JSON。",
        128,
        "connection_test",
      );
      if (result?.ok !== true) throw new Error("模型已响应，但没有返回预期结果");
      return { latencyMs: Date.now() - startedAt, model };
    },
    async classify({ question, answerExcerpt = "", existingCollections }) {
      if (!enabled) return null;
      const result = await completeJson(
        promptFor(question, answerExcerpt, existingCollections),
        "你是一个严格输出 JSON 的面试题分类器。",
        300,
        "classification",
      );
      if (typeof result?.shouldStore !== "boolean") throw new Error("分类模型缺少明确的 shouldStore 判断");
      if (result.shouldStore && !["use_existing", "create_new"].includes(result.action)) {
        throw new Error("分类模型缺少有效的分类动作");
      }
      return result;
    },
    async findDuplicate({ question, existingQuestions = [] }) {
      if (!enabled || !existingQuestions.length) return null;
      const candidates = existingQuestions.slice(0, 60);
      const result = await completeJson(
        duplicatePromptFor(question, candidates),
        "你是一个宁可漏判也不误判的重复题检测器，只输出 JSON。",
        180,
        "duplicate_detection",
      );
      const duplicateId = clean(result?.duplicateId, 100);
      if (!duplicateId) return null;
      if (!candidates.some((candidate) => candidate.id === duplicateId)) {
        throw new Error("重复题检测模型返回了未知候选 ID");
      }
      return { duplicateId, reason: clean(result?.reason, 160) };
    },
  };
}

export const classifierDefaults = {
  baseUrl: DEFAULT_BASE_URL,
  endpoint: DEFAULT_ENDPOINT,
  model: DEFAULT_MODEL,
};
