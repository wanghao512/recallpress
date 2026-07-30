import { createServer } from "node:http";
import { fileURLToPath } from "node:url";
import path from "node:path";

import {
  loadApiSettings,
  loadApiUsage,
  publicApiSettings,
  recordApiUsage,
  resetApiUsage,
  resolveApiSettings,
  saveApiSettings,
} from "./api-settings.mjs";
import { createQuestionClassifier, fallbackQuestionList, loadLocalEnv } from "./classifier.mjs";
import {
  activateProfile,
  activeProfile,
  createProfile,
  deleteProfile,
  loadProfiles,
  updateProfile,
  validateProjectRoot,
  validateProfileValues,
} from "./profiles.mjs";
import { updateKnowledgeBaseSettings } from "./settings.mjs";
import { createCollection, listCollections, renameCollection, saveConversation, verifyLastQuestion } from "./sync.mjs";

const serviceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
await loadLocalEnv(serviceRoot);
const host = "127.0.0.1";
const port = Number.parseInt(process.env.CHATGPT_SYNC_PORT || "3847", 10);
const maxBodyBytes = 5 * 1024 * 1024;
const defaultSiteBaseUrl = process.env.CHATGPT_SYNC_SITE_URL || "http://localhost:8080";
let profileState = await loadProfiles(serviceRoot, defaultSiteBaseUrl);
let currentProfile = activeProfile(profileState);
let currentProjectRoot = currentProfile.projectRoot;
await loadLocalEnv(currentProjectRoot);
let apiSettings = await loadApiSettings(currentProjectRoot);
let classifier = createQuestionClassifier({
  ...apiSettings,
  onUsage: (usage) => recordApiUsage(currentProjectRoot, usage),
});

function pageUrl(pagePath, profile = currentProfile) {
  return pagePath ? new URL(pagePath, profile.siteUrl).href : "";
}

function runtimeSnapshot() {
  return {
    classifier,
    profile: currentProfile,
    projectRoot: currentProjectRoot,
  };
}

async function refreshRuntime() {
  currentProfile = activeProfile(profileState);
  currentProjectRoot = currentProfile.projectRoot;
  await loadLocalEnv(currentProjectRoot);
  apiSettings = await loadApiSettings(currentProjectRoot);
  const usageRoot = currentProjectRoot;
  classifier = createQuestionClassifier({
    ...apiSettings,
    onUsage: (usage) => recordApiUsage(usageRoot, usage),
  });
}

function publicActiveProfile(profile = currentProfile) {
  return {
    id: profile.id,
    libraryName: profile.libraryName,
    profileName: profile.profileName,
  };
}

function sendJson(response, statusCode, body, origin = "") {
  const headers = {
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, OPTIONS",
    "Cache-Control": "no-store",
    "Content-Type": "application/json; charset=utf-8",
  };

  if (/^https:\/\/(chatgpt\.com|chat\.openai\.com)$/i.test(origin) || origin.startsWith("chrome-extension://")) {
    headers["Access-Control-Allow-Origin"] = origin;
  }

  response.writeHead(statusCode, headers);
  response.end(JSON.stringify(body));
}

async function readJson(request) {
  const chunks = [];
  let size = 0;

  for await (const chunk of request) {
    size += chunk.length;
    if (size > maxBodyBytes) throw new Error("对话内容超过 5 MB 限制");
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

const server = createServer(async (request, response) => {
  const origin = request.headers.origin || "";

  if (request.method === "OPTIONS") {
    sendJson(response, 204, {}, origin);
    return;
  }

  if (
    /^\/api\/(?:config|profiles|questions\/organize)/u.test(request.url || "") &&
    origin &&
    !origin.startsWith("chrome-extension://")
  ) {
    sendJson(response, 403, { ok: false, error: "本地档案和模型功能只能由扩展访问" }, origin);
    return;
  }

  if (request.method === "GET" && request.url === "/health") {
    sendJson(
      response,
      200,
      {
        classifier: {
          enabled: classifier.enabled,
          model: classifier.model,
          reason: classifier.reason,
        },
        profile: publicActiveProfile(),
        ok: true,
        service: "chatgpt-vuepress-sync",
      },
      origin,
    );
    return;
  }

  if (request.method === "GET" && request.url === "/api/config") {
    try {
      const runtime = runtimeSnapshot();
      sendJson(
        response,
        200,
        {
          ok: true,
          profile: runtime.profile,
          settings: publicApiSettings(apiSettings),
          usage: await loadApiUsage(runtime.projectRoot),
        },
        origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取 API 配置失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/questions/organize") {
    try {
      const payload = await readJson(request);
      const fallbackQuestions = fallbackQuestionList(payload?.text);
      if (!fallbackQuestions.length) throw new Error("请先填写需要整理的问题素材");

      if (!classifier.enabled) {
        sendJson(
          response,
          200,
          {
            mode: "fallback",
            model: "",
            ok: true,
            questions: fallbackQuestions,
            reason: classifier.reason,
          },
          origin,
        );
        return;
      }

      const questions = await classifier.organizeQuestions(payload.text);
      sendJson(response, 200, { mode: "llm", model: classifier.model, ok: true, questions }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "问题清单整理失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "PUT" && request.url === "/api/config") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const savedSettings = await saveApiSettings(runtime.projectRoot, payload);
      const usageRoot = runtime.projectRoot;
      if (currentProjectRoot === runtime.projectRoot) {
        apiSettings = savedSettings;
        classifier = createQuestionClassifier({
          ...savedSettings,
          onUsage: (usage) => recordApiUsage(usageRoot, usage),
        });
      }
      sendJson(
        response,
        200,
        {
          ok: true,
          profile: runtime.profile,
          settings: publicApiSettings(savedSettings),
          usage: await loadApiUsage(runtime.projectRoot),
        },
        origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "保存 API 配置失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/config/test") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const candidate = await resolveApiSettings(runtime.projectRoot, { ...payload, enabled: true });
      const tester = createQuestionClassifier({
        ...candidate,
        enabled: true,
        onUsage: (usage) => recordApiUsage(runtime.projectRoot, usage),
      });
      const result = await tester.testConnection();
      sendJson(response, 200, { ok: true, ...result, usage: await loadApiUsage(runtime.projectRoot) }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "API 连通性测试失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/config/usage/reset") {
    try {
      const runtime = runtimeSnapshot();
      sendJson(response, 200, { ok: true, usage: await resetApiUsage(runtime.projectRoot) }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "清空用量统计失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/api/profiles") {
    profileState = await loadProfiles(serviceRoot, defaultSiteBaseUrl);
    await refreshRuntime();
    sendJson(response, 200, { ok: true, ...profileState }, origin);
    return;
  }

  if (request.method === "POST" && request.url === "/api/profiles") {
    try {
      const payload = await readJson(request);
      const projectRoot = await validateProjectRoot(payload.projectRoot);
      if (profileState.profiles.some((profile) => profile.projectRoot === projectRoot)) {
        throw new Error("这个 VuePress 项目已经存在于档案列表中");
      }
      const candidate = validateProfileValues({
        ...payload,
        id: "new-profile",
        projectRoot,
      });
      await updateKnowledgeBaseSettings(projectRoot, { libraryName: candidate.libraryName });
      const result = await createProfile(
        serviceRoot,
        candidate,
        defaultSiteBaseUrl,
      );
      profileState = {
        activeProfileId: result.activeProfileId,
        profiles: result.profiles,
        version: result.version,
      };
      sendJson(response, 201, { ok: true, ...result }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "新建知识库档案失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  const profileActivateMatch = request.url?.match(/^\/api\/profiles\/([^/?#]+)\/activate$/u);
  if (request.method === "POST" && profileActivateMatch) {
    try {
      const result = await activateProfile(
        serviceRoot,
        decodeURIComponent(profileActivateMatch[1]),
        defaultSiteBaseUrl,
      );
      profileState = {
        activeProfileId: result.activeProfileId,
        profiles: result.profiles,
        version: result.version,
      };
      await refreshRuntime();
      sendJson(
        response,
        200,
        {
          ok: true,
          ...profileState,
          profile: currentProfile,
          settings: publicApiSettings(apiSettings),
          usage: await loadApiUsage(currentProjectRoot),
        },
        origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "切换知识库档案失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  const profileMatch = request.url?.match(/^\/api\/profiles\/([^/?#]+)$/u);
  if (request.method === "PATCH" && profileMatch) {
    try {
      const profileId = decodeURIComponent(profileMatch[1]);
      const payload = await readJson(request);
      const existing = profileState.profiles.find((profile) => profile.id === profileId);
      if (!existing) throw new Error("没有找到要修改的知识库档案");
      const projectRoot =
        payload.projectRoot === undefined ? existing.projectRoot : await validateProjectRoot(payload.projectRoot);
      const libraryName = payload.libraryName ?? existing.libraryName;
      if (
        profileState.profiles.some(
          (profile) => profile.id !== profileId && profile.projectRoot === projectRoot,
        )
      ) {
        throw new Error("这个 VuePress 项目已经存在于其他档案中");
      }
      const candidate = validateProfileValues(
        { ...existing, ...payload, id: existing.id, projectRoot, libraryName },
        existing,
      );
      if (payload.libraryName !== undefined || payload.projectRoot !== undefined) {
        await updateKnowledgeBaseSettings(projectRoot, { libraryName: candidate.libraryName });
      }
      const result = await updateProfile(
        serviceRoot,
        profileId,
        candidate,
        defaultSiteBaseUrl,
      );
      profileState = {
        activeProfileId: result.activeProfileId,
        profiles: result.profiles,
        version: result.version,
      };
      if (profileState.activeProfileId === profileId) await refreshRuntime();
      sendJson(response, 200, { ok: true, ...result }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "修改知识库档案失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "DELETE" && profileMatch) {
    try {
      profileState = await deleteProfile(
        serviceRoot,
        decodeURIComponent(profileMatch[1]),
        defaultSiteBaseUrl,
      );
      await refreshRuntime();
      sendJson(response, 200, { ok: true, ...profileState, profile: currentProfile }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "删除知识库档案失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "GET" && request.url === "/api/collections") {
    try {
      const runtime = runtimeSnapshot();
      const collections = await listCollections(runtime.projectRoot);
      sendJson(response, 200, { collections, ok: true }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "读取分类失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/collections") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const result = await createCollection(runtime.projectRoot, payload);
      sendJson(response, 201, { ok: true, ...result }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "新建分类失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  const renameMatch = request.url?.match(/^\/api\/collections\/([^/?#]+)$/u);
  if (request.method === "PATCH" && renameMatch) {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const result = await renameCollection(runtime.projectRoot, decodeURIComponent(renameMatch[1]), payload);
      sendJson(response, 200, { ok: true, ...result }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "重命名分类失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/sync") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const result = await saveConversation(runtime.projectRoot, payload, { classifier: runtime.classifier });
      sendJson(
        response,
        result.created ? 201 : 200,
        { ok: true, ...result, pageUrl: pageUrl(result.pagePath, runtime.profile), profile: runtime.profile },
        origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "同步失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/verify") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const result = await verifyLastQuestion(runtime.projectRoot, payload);
      sendJson(
        response,
        200,
        { ok: true, ...result, pageUrl: pageUrl(result.pagePath, runtime.profile), profile: runtime.profile },
        origin,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : "检查最后一道问题失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  if (request.method === "POST" && request.url === "/api/settings") {
    try {
      const runtime = runtimeSnapshot();
      const payload = await readJson(request);
      const result = await updateKnowledgeBaseSettings(runtime.projectRoot, payload);
      const updated = await updateProfile(
        serviceRoot,
        runtime.profile.id,
        { libraryName: result.libraryName },
        defaultSiteBaseUrl,
      );
      profileState = {
        activeProfileId: updated.activeProfileId,
        profiles: updated.profiles,
        version: updated.version,
      };
      currentProfile = activeProfile(profileState);
      sendJson(response, 200, { ok: true, ...result, profile: currentProfile }, origin);
    } catch (error) {
      const message = error instanceof Error ? error.message : "更新知识库设置失败";
      sendJson(response, 400, { ok: false, error: message }, origin);
    }
    return;
  }

  sendJson(response, 404, { ok: false, error: "接口不存在" }, origin);
});

server.listen(port, host, () => {
  console.log(`ChatGPT 同步服务已启动: http://${host}:${port}`);
  console.log(`当前知识库档案: ${currentProfile.profileName}`);
  console.log(`Markdown 保存目录: ${path.join(currentProjectRoot, "src", "interview", "chatgpt")}`);
  console.log(
    classifier.enabled ? `智能分类已启用: ${classifier.model}` : `智能分类未启用: ${classifier.reason}`,
  );
});

function shutdown() {
  server.close(() => process.exit(0));
}

process.on("SIGINT", shutdown);
process.on("SIGTERM", shutdown);
