import { randomUUID } from "node:crypto";
import { mkdir, readFile, rename, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";

const PROFILES_VERSION = 1;
let writeQueue = Promise.resolve();

function clean(value, maxLength = 1_000) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, maxLength);
}

function profilesPath(serviceRoot) {
  return path.join(serviceRoot, ".chatgpt-sync", "profiles.json");
}

function expandProjectRoot(value) {
  const input = clean(value, 2_000);
  const expanded = input === "~" ? os.homedir() : input.startsWith("~/") ? path.join(os.homedir(), input.slice(2)) : input;
  return path.resolve(expanded);
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

async function readLibraryName(projectRoot, fallback = "我的知识库") {
  const content = await readFile(path.join(projectRoot, "src", ".vuepress", "knowledgeBase.ts"), "utf8").catch(() => "");
  return clean(content.match(/\bname:\s*["']([^"']+)["']/u)?.[1], 24) || clean(fallback, 24) || "我的知识库";
}

function defaultProfileName(libraryName, projectRoot) {
  return clean(libraryName.replace(/知识库$|库$/u, ""), 24) || clean(path.basename(projectRoot), 24) || "默认知识库";
}

function normalizeSiteUrl(value, fallback = "http://localhost:8080") {
  const siteUrl = clean(value, 1_000) || fallback;
  let parsed;
  try {
    parsed = new URL(siteUrl);
  } catch {
    throw new Error("站点预览地址不是有效 URL");
  }
  const localHttp = parsed.protocol === "http:" && ["127.0.0.1", "localhost"].includes(parsed.hostname);
  if (parsed.protocol !== "https:" && !localHttp) throw new Error("站点预览地址必须使用 HTTPS，本机地址可使用 HTTP");
  return parsed.href.replace(/\/+$/, "");
}

function normalizeProfile(input, fallback = {}) {
  const projectRoot = expandProjectRoot(input?.projectRoot ?? fallback.projectRoot);
  const libraryName = clean(input?.libraryName ?? fallback.libraryName, 24);
  const profileName = clean(input?.profileName ?? fallback.profileName, 24);
  if (!profileName) throw new Error("档案名称不能为空");
  if (!libraryName) throw new Error("知识库名称不能为空");
  return {
    classificationMode: input?.classificationMode === "fixed" ? "fixed" : "llm",
    fixedCollectionId: clean(input?.fixedCollectionId ?? fallback.fixedCollectionId, 100),
    fixedCollectionTitle: clean(input?.fixedCollectionTitle ?? fallback.fixedCollectionTitle, 80),
    id: clean(input?.id ?? fallback.id, 100),
    libraryName,
    profileName,
    projectRoot,
    siteUrl: normalizeSiteUrl(input?.siteUrl ?? fallback.siteUrl),
  };
}

export function validateProfileValues(input, fallback = {}) {
  return normalizeProfile(input, fallback);
}

function publicState(state) {
  return {
    activeProfileId: state.activeProfileId,
    profiles: state.profiles.map((profile) => ({ ...profile })),
    version: state.version,
  };
}

async function saveState(serviceRoot, state) {
  writeQueue = writeQueue.then(() => atomicJson(profilesPath(serviceRoot), state));
  await writeQueue;
  return publicState(state);
}

export async function validateProjectRoot(value) {
  const projectRoot = expandProjectRoot(value);
  const packagePath = path.join(projectRoot, "package.json");
  const required = [
    [packagePath, "file"],
    [path.join(projectRoot, "src", ".vuepress"), "directory"],
    [path.join(projectRoot, "src", "README.md"), "file"],
    [path.join(projectRoot, "src", "interview", "README.md"), "file"],
  ];

  for (const [target, type] of required) {
    const details = await stat(target).catch(() => null);
    if (!details || (type === "file" ? !details.isFile() : !details.isDirectory())) {
      throw new Error("项目目录不是兼容的 VuePress 知识库，请选择包含 package.json、src/.vuepress 和 src/interview 的目录");
    }
  }
  const packageJson = await readJson(packagePath);
  if (!packageJson?.scripts?.["docs:dev"]) {
    throw new Error("项目 package.json 缺少 docs:dev 脚本，无法自动启动 VuePress 预览");
  }
  return projectRoot;
}

export async function loadProfiles(serviceRoot, defaultSiteUrl = "http://localhost:8080") {
  const stored = await readJson(profilesPath(serviceRoot));
  const libraryName = await readLibraryName(serviceRoot);
  const defaultProfile = normalizeProfile({
    id: "default",
    libraryName,
    profileName: defaultProfileName(libraryName, serviceRoot),
    projectRoot: serviceRoot,
    siteUrl: defaultSiteUrl,
  });
  const storedProfiles = Array.isArray(stored?.profiles)
    ? (
        await Promise.all(
          stored.profiles.map(async (profile) => {
            try {
              const normalized = normalizeProfile(profile, defaultProfile);
              const currentLibraryName = await readLibraryName(normalized.projectRoot, normalized.libraryName);
              const legacyGeneratedProfileName = defaultProfileName(normalized.libraryName, normalized.projectRoot);
              const profileName =
                normalized.id === "default" &&
                normalized.profileName === legacyGeneratedProfileName &&
                currentLibraryName !== normalized.libraryName
                  ? defaultProfileName(currentLibraryName, normalized.projectRoot)
                  : normalized.profileName;
              return { ...normalized, libraryName: currentLibraryName, profileName };
            } catch {
              return null;
            }
          }),
        )
      ).filter(Boolean)
    : [];
  const uniqueIds = new Set();
  const profiles = (storedProfiles.length ? storedProfiles : [defaultProfile]).filter((profile) => {
    if (!profile.id || uniqueIds.has(profile.id)) return false;
    uniqueIds.add(profile.id);
    return true;
  });
  if (!profiles.some((profile) => profile.id === "default" && profile.projectRoot === serviceRoot)) {
    profiles.unshift(defaultProfile);
  }
  const activeProfileId = profiles.some((profile) => profile.id === stored?.activeProfileId)
    ? stored.activeProfileId
    : profiles[0].id;
  const state = { activeProfileId, profiles, version: PROFILES_VERSION };
  const storedSnapshot =
    stored && Array.isArray(stored.profiles)
      ? {
          activeProfileId: stored.activeProfileId,
          profiles: stored.profiles,
          version: stored.version,
        }
      : null;
  if (!storedSnapshot || JSON.stringify(storedSnapshot) !== JSON.stringify(publicState(state))) {
    await saveState(serviceRoot, state);
  }
  return publicState(state);
}

export async function createProfile(serviceRoot, input, defaultSiteUrl = "http://localhost:8080") {
  const state = await loadProfiles(serviceRoot, defaultSiteUrl);
  const projectRoot = await validateProjectRoot(input?.projectRoot);
  if (state.profiles.some((profile) => profile.projectRoot === projectRoot)) {
    throw new Error("这个 VuePress 项目已经存在于档案列表中");
  }
  const profile = normalizeProfile({
    ...input,
    id: randomUUID(),
    projectRoot,
  });
  const next = { ...state, profiles: [...state.profiles, profile] };
  await saveState(serviceRoot, next);
  return { profile, ...publicState(next) };
}

export async function updateProfile(serviceRoot, profileId, input, defaultSiteUrl = "http://localhost:8080") {
  const state = await loadProfiles(serviceRoot, defaultSiteUrl);
  const index = state.profiles.findIndex((profile) => profile.id === clean(profileId, 100));
  if (index < 0) throw new Error("没有找到要修改的知识库档案");
  const current = state.profiles[index];
  const projectRoot =
    input?.projectRoot === undefined ? current.projectRoot : await validateProjectRoot(input.projectRoot);
  if (state.profiles.some((profile, profileIndex) => profileIndex !== index && profile.projectRoot === projectRoot)) {
    throw new Error("这个 VuePress 项目已经存在于其他档案中");
  }
  const profile = normalizeProfile({ ...current, ...input, id: current.id, projectRoot }, current);
  const profiles = [...state.profiles];
  profiles[index] = profile;
  const next = { ...state, profiles };
  await saveState(serviceRoot, next);
  return { profile, ...publicState(next) };
}

export async function activateProfile(serviceRoot, profileId, defaultSiteUrl = "http://localhost:8080") {
  const state = await loadProfiles(serviceRoot, defaultSiteUrl);
  const profile = state.profiles.find((item) => item.id === clean(profileId, 100));
  if (!profile) throw new Error("没有找到要切换的知识库档案");
  await validateProjectRoot(profile.projectRoot);
  const next = { ...state, activeProfileId: profile.id };
  await saveState(serviceRoot, next);
  return { profile, ...publicState(next) };
}

export async function deleteProfile(serviceRoot, profileId, defaultSiteUrl = "http://localhost:8080") {
  const state = await loadProfiles(serviceRoot, defaultSiteUrl);
  if (state.profiles.length <= 1) throw new Error("至少需要保留一个知识库档案");
  const profiles = state.profiles.filter((profile) => profile.id !== clean(profileId, 100));
  if (profiles.length === state.profiles.length) throw new Error("没有找到要删除的知识库档案");
  const activeProfileId = state.activeProfileId === profileId ? profiles[0].id : state.activeProfileId;
  const next = { ...state, activeProfileId, profiles };
  await saveState(serviceRoot, next);
  return publicState(next);
}

export function activeProfile(state) {
  return state.profiles.find((profile) => profile.id === state.activeProfileId) || state.profiles[0];
}
