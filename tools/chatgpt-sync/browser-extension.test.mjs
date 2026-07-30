import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import vm from "node:vm";

const backgroundSource = await readFile(new URL("../../browser-extension/background.js", import.meta.url), "utf8");

function loadBackground(runtimeOverrides = {}, tabs = undefined) {
  let messageListener;
  const chrome = {
    runtime: {
      getURL: (path) => `chrome-extension://test/${path}`,
      onInstalled: { addListener() {} },
      onMessage: {
        addListener(listener) {
          messageListener = listener;
        },
      },
      ...runtimeOverrides,
    },
    storage: {
      local: {
        get(_defaults, callback) {
          callback({ libraryName: "测试知识库" });
        },
        set() {},
      },
    },
    tabs,
  };

  vm.runInNewContext(backgroundSource, { chrome, fetch }, { filename: "background.js" });
  return messageListener;
}

function sendMessage(listener, message) {
  return new Promise((resolve) => {
    assert.equal(listener(message, {}, resolve), true);
  });
}

test("浏览器支持 openOptionsPage 时直接打开扩展设置页", async () => {
  let opened = false;
  const listener = loadBackground({
    async openOptionsPage() {
      opened = true;
    },
  });

  assert.deepEqual({ ...(await sendMessage(listener, { type: "chatgpt-sync:open-options" })) }, { ok: true });
  assert.equal(opened, true);
});

test("缺少 openOptionsPage 时回退为扩展内部标签页", async () => {
  let createdUrl = "";
  const listener = loadBackground(
    {},
    {
      async create({ url }) {
        createdUrl = url;
      },
    },
  );

  assert.deepEqual({ ...(await sendMessage(listener, { type: "chatgpt-sync:open-options" })) }, { ok: true });
  assert.equal(createdUrl, "chrome-extension://test/options/options.html");
});
