const serviceUrl = "http://127.0.0.1:3847";

chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.get({ libraryName: "" }, ({ libraryName }) => {
    if (libraryName) return;
    chrome.storage.local.set({ libraryName: "我的知识库" });
  });
});

async function request(path, options = {}) {
  const response = await fetch(`${serviceUrl}${path}`, options);
  const body = await response.json().catch(() => ({}));

  if (!response.ok) {
    throw new Error(body.error || `本地服务返回 ${response.status}`);
  }

  return body;
}

async function openExtensionOptions() {
  if (typeof chrome.runtime.openOptionsPage === "function") {
    await chrome.runtime.openOptionsPage();
    return;
  }

  if (typeof chrome.tabs?.create === "function") {
    await chrome.tabs.create({ url: chrome.runtime.getURL("options/options.html") });
    return;
  }

  throw new Error("当前浏览器无法打开扩展设置页");
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  if (message?.type === "chatgpt-sync:open-options") {
    openExtensionOptions()
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:health") {
    request("/health")
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:collections") {
    request("/api/collections")
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:api-config") {
    request("/api/config")
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:profiles") {
    request("/api/profiles")
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:create-profile") {
    request("/api/profiles", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:update-profile") {
    request(`/api/profiles/${encodeURIComponent(message.profileId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:delete-profile") {
    request(`/api/profiles/${encodeURIComponent(message.profileId)}`, { method: "DELETE" })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:activate-profile") {
    request(`/api/profiles/${encodeURIComponent(message.profileId)}/activate`, { method: "POST" })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:save-api-config") {
    request("/api/config", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:test-api-config") {
    request("/api/config/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:reset-api-usage") {
    request("/api/config/usage/reset", { method: "POST" })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:organize-questions") {
    request("/api/questions/organize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ text: message.text }),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:create-collection") {
    request("/api/collections", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:rename-collection") {
    request(`/api/collections/${encodeURIComponent(message.collectionId)}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:save") {
    request("/api/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:verify-last") {
    request("/api/verify", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === "chatgpt-sync:settings") {
    request("/api/settings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(message.payload),
    })
      .then((body) => sendResponse({ ok: true, ...body }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
