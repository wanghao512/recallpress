const elements = {
  apiKey: document.querySelector("#api-key"),
  baseUrl: document.querySelector("#base-url"),
  completionTokens: document.querySelector("#completion-tokens"),
  enabled: document.querySelector("#enabled"),
  endpoint: document.querySelector("#endpoint"),
  form: document.querySelector("#settings-form"),
  keyState: document.querySelector("#key-state"),
  lastModel: document.querySelector("#last-model"),
  lastUsed: document.querySelector("#last-used"),
  meter: document.querySelector("#usage-meter"),
  model: document.querySelector("#model"),
  newProfile: document.querySelector("#new-profile"),
  editProfile: document.querySelector("#edit-profile"),
  deleteProfile: document.querySelector("#delete-profile"),
  profileDialog: document.querySelector("#profile-dialog"),
  profileDialogTitle: document.querySelector("#profile-dialog-title"),
  profileForm: document.querySelector("#profile-form"),
  profileLibraryName: document.querySelector("#profile-library-name"),
  profileName: document.querySelector("#profile-name"),
  profilePath: document.querySelector("#profile-path"),
  profileProjectRoot: document.querySelector("#profile-project-root"),
  profileSelect: document.querySelector("#profile-select"),
  profileSiteUrl: document.querySelector("#profile-site-url"),
  saveProfile: document.querySelector("#save-profile"),
  cancelProfile: document.querySelector("#cancel-profile"),
  closeProfileDialog: document.querySelector("#close-profile-dialog"),
  promptTokens: document.querySelector("#prompt-tokens"),
  refreshUsage: document.querySelector("#refresh-usage"),
  requests: document.querySelector("#requests"),
  resetUsage: document.querySelector("#reset-usage"),
  save: document.querySelector("#save-settings"),
  status: document.querySelector(".status-banner"),
  statusCopy: document.querySelector(".status-copy"),
  test: document.querySelector("#test-connection"),
  toggleKey: document.querySelector("#toggle-key"),
  totalTokens: document.querySelector("#total-tokens"),
};
const profileState = {
  activeProfileId: "",
  editorMode: "create",
  profiles: [],
};

function sendMessage(message) {
  return new Promise((resolve) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        resolve({ ok: false, error: "扩展刚刚更新，请重新打开设置页" });
        return;
      }
      resolve(response || { ok: false, error: "本地服务没有响应" });
    });
  });
}

function formatNumber(value) {
  return new Intl.NumberFormat("zh-CN").format(Number(value) || 0);
}

function showStatus(message, error = false) {
  elements.statusCopy.textContent = message;
  elements.status.classList.toggle("error", error);
  elements.status.hidden = false;
}

function renderUsage(usage = {}) {
  const total = Number(usage.totalTokens) || 0;
  elements.totalTokens.textContent = formatNumber(total);
  elements.requests.textContent = formatNumber(usage.requests);
  elements.promptTokens.textContent = formatNumber(usage.promptTokens);
  elements.completionTokens.textContent = formatNumber(usage.completionTokens);
  elements.lastModel.textContent = usage.lastModel || "暂无记录";
  elements.lastUsed.textContent = usage.lastUsedAt
    ? new Intl.DateTimeFormat("zh-CN", { dateStyle: "medium", timeStyle: "short" }).format(new Date(usage.lastUsedAt))
    : "暂无记录";
  elements.meter.style.width = `${Math.min(100, Math.max(4, Math.log10(total + 1) * 18))}%`;
}

function renderSettings(settings = {}) {
  elements.baseUrl.value = settings.baseUrl || "";
  elements.model.value = settings.model || "";
  elements.endpoint.value = settings.endpoint || "/v1/chat/completions";
  elements.enabled.checked = settings.enabled !== false;
  elements.apiKey.value = "";
  elements.apiKey.placeholder = settings.hasApiKey ? `${settings.maskedApiKey} · 留空保持原值` : "请输入 API Key";
  elements.keyState.textContent = settings.hasApiKey ? "已保存密钥；页面不会读取或显示原文" : "尚未配置 API Key";
}

function currentProfile() {
  return profileState.profiles.find((profile) => profile.id === profileState.activeProfileId) || null;
}

function renderProfiles(state = {}) {
  profileState.activeProfileId = state.activeProfileId || "";
  profileState.profiles = Array.isArray(state.profiles) ? state.profiles : [];
  elements.profileSelect.replaceChildren();
  for (const profile of profileState.profiles) {
    const option = document.createElement("option");
    option.value = profile.id;
    option.textContent = `${profile.profileName} · ${profile.libraryName}`;
    elements.profileSelect.append(option);
  }
  elements.profileSelect.value = profileState.activeProfileId;
  const active = currentProfile();
  elements.profilePath.textContent = active
    ? `${active.projectRoot} · ${active.classificationMode === "fixed" ? `固定到 ${active.fixedCollectionTitle || "指定分类"}` : "智能分类"}`
    : "暂无可用知识库档案";
  elements.editProfile.disabled = !active;
  elements.deleteProfile.disabled = profileState.profiles.length <= 1;
}

function announceProfileChange() {
  chrome.storage.local.set({
    activeProfileId: profileState.activeProfileId,
    profileRevision: Date.now(),
  });
}

async function loadProfiles() {
  const result = await sendMessage({ type: "chatgpt-sync:profiles" });
  if (!result.ok) {
    showStatus(result.error || "无法读取知识库档案", true);
    return result;
  }
  renderProfiles(result);
  return result;
}

async function activateProfile(profileId, confirmation = true) {
  elements.profileSelect.disabled = true;
  const result = await sendMessage({ type: "chatgpt-sync:activate-profile", profileId });
  elements.profileSelect.disabled = false;
  if (!result.ok) {
    elements.profileSelect.value = profileState.activeProfileId;
    showStatus(result.error || "切换知识库档案失败", true);
    return result;
  }
  renderProfiles(result);
  renderSettings(result.settings);
  renderUsage(result.usage);
  announceProfileChange();
  if (confirmation) showStatus(`已切换到“${result.profile.profileName}”`);
  return result;
}

function currentPayload() {
  const payload = {
    baseUrl: elements.baseUrl.value.trim(),
    enabled: elements.enabled.checked,
    endpoint: elements.endpoint.value.trim(),
    model: elements.model.value.trim(),
  };
  const apiKey = elements.apiKey.value.trim();
  if (apiKey) payload.apiKey = apiKey;
  return payload;
}

function profilePayload() {
  return {
    libraryName: elements.profileLibraryName.value.trim(),
    profileName: elements.profileName.value.trim(),
    projectRoot: elements.profileProjectRoot.value.trim(),
    siteUrl: elements.profileSiteUrl.value.trim(),
  };
}

function openProfileEditor(mode) {
  const active = currentProfile();
  profileState.editorMode = mode;
  elements.profileDialogTitle.textContent = mode === "edit" ? "编辑知识库档案" : "新建知识库档案";
  elements.profileName.value = mode === "edit" ? active?.profileName || "" : "";
  elements.profileLibraryName.value = mode === "edit" ? active?.libraryName || "" : "";
  elements.profileProjectRoot.value = mode === "edit" ? active?.projectRoot || "" : "";
  elements.profileSiteUrl.value = mode === "edit" ? active?.siteUrl || "http://localhost:8080" : "http://localhost:8080";
  elements.profileDialog.showModal();
  elements.profileName.focus();
}

function closeProfileEditor() {
  elements.profileDialog.close();
  elements.saveProfile.disabled = false;
  elements.saveProfile.querySelector("span").textContent = "保存档案";
}

function setBusy(button, busy, busyText, idleText) {
  button.disabled = busy;
  button.querySelector("span").textContent = busy ? busyText : idleText;
}

async function loadConfig(showConfirmation = false) {
  elements.refreshUsage.disabled = true;
  const result = await sendMessage({ type: "chatgpt-sync:api-config" });
  elements.refreshUsage.disabled = false;
  if (!result.ok) {
    showStatus(result.error || "无法连接本地同步服务，请先运行 pnpm dev:sync", true);
    return;
  }
  renderSettings(result.settings);
  renderUsage(result.usage);
  if (showConfirmation) showStatus("配置和用量已刷新");
}

async function loadPage() {
  const profiles = await loadProfiles();
  if (!profiles.ok) return;
  await loadConfig();
}

elements.form.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(elements.save, true, "正在保存…", "保存并应用");
  const result = await sendMessage({ type: "chatgpt-sync:save-api-config", payload: currentPayload() });
  setBusy(elements.save, false, "正在保存…", "保存并应用");
  if (!result.ok) {
    showStatus(result.error || "保存失败", true);
    return;
  }
  renderSettings(result.settings);
  renderUsage(result.usage);
  showStatus("配置已保存并立即生效，无需重启服务");
});

elements.test.addEventListener("click", async () => {
  setBusy(elements.test, true, "正在测试…", "测试连接");
  showStatus("正在请求模型，这会产生一次很小的 Token 用量");
  const result = await sendMessage({ type: "chatgpt-sync:test-api-config", payload: currentPayload() });
  setBusy(elements.test, false, "正在测试…", "测试连接");
  if (!result.ok) {
    showStatus(result.error || "连接测试失败", true);
    return;
  }
  renderUsage(result.usage);
  showStatus(`连接成功 · ${result.model} · ${result.latencyMs} ms`);
});

elements.refreshUsage.addEventListener("click", () => loadConfig(true));

elements.resetUsage.addEventListener("click", async () => {
  if (!confirm("只清空扩展记录的本地 Token 统计，不影响模型服务商账单。确定继续吗？")) return;
  const result = await sendMessage({ type: "chatgpt-sync:reset-api-usage" });
  if (!result.ok) {
    showStatus(result.error || "清空统计失败", true);
    return;
  }
  renderUsage(result.usage);
  showStatus("本地用量统计已清空");
});

elements.toggleKey.addEventListener("click", () => {
  const visible = elements.apiKey.type === "text";
  elements.apiKey.type = visible ? "password" : "text";
  elements.toggleKey.setAttribute("aria-label", visible ? "显示 API Key" : "隐藏 API Key");
});

elements.profileSelect.addEventListener("change", () => activateProfile(elements.profileSelect.value));
elements.newProfile.addEventListener("click", () => openProfileEditor("create"));
elements.editProfile.addEventListener("click", () => openProfileEditor("edit"));
elements.cancelProfile.addEventListener("click", closeProfileEditor);
elements.closeProfileDialog.addEventListener("click", closeProfileEditor);

elements.profileForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  setBusy(elements.saveProfile, true, "正在保存…", "保存档案");
  const active = currentProfile();
  const message =
    profileState.editorMode === "edit"
      ? {
          type: "chatgpt-sync:update-profile",
          profileId: active?.id,
          payload: profilePayload(),
        }
      : {
          type: "chatgpt-sync:create-profile",
          payload: profilePayload(),
        };
  const result = await sendMessage(message);
  if (!result.ok) {
    setBusy(elements.saveProfile, false, "正在保存…", "保存档案");
    showStatus(result.error || "保存知识库档案失败", true);
    return;
  }
  closeProfileEditor();
  renderProfiles(result);
  if (profileState.editorMode === "create") {
    await activateProfile(result.profile.id);
  } else {
    await loadConfig();
    announceProfileChange();
    showStatus(`“${result.profile.profileName}”已更新`);
  }
});

elements.deleteProfile.addEventListener("click", async () => {
  const active = currentProfile();
  if (!active) return;
  if (!confirm(`从助手中移除“${active.profileName}”？VuePress 项目和文章不会被删除。`)) return;
  const result = await sendMessage({ type: "chatgpt-sync:delete-profile", profileId: active.id });
  if (!result.ok) {
    showStatus(result.error || "移除知识库档案失败", true);
    return;
  }
  renderProfiles(result);
  await activateProfile(result.activeProfileId, false);
  showStatus("档案已移除，项目文件保持不变");
});

loadPage();
