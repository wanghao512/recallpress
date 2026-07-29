(() => {
  if (window.__jobPrepVuePressSyncLoaded) return;
  window.__jobPrepVuePressSyncLoaded = true;

  const state = {
    autoSync: false,
    activeProfileId: "",
    baseline: null,
    cacheConversationId: "",
    cacheSequence: 0,
    classificationMode: "llm",
    collections: [],
    conversationId: "",
    failedSignature: "",
    fixedCollectionId: "",
    fixedCollectionTitle: "",
    dockStatus: "idle",
    libraryName: "我的知识库",
    messageCache: new Map(),
    pinned: false,
    profiles: [],
    scanTimer: null,
    sawGeneration: false,
    syncScope: "last",
    syncing: false,
  };

  function conversationId() {
    return location.pathname.match(/\/c\/([^/?#]+)/)?.[1] || "";
  }

  function cleanClone(root) {
    const clone = root.cloneNode(true);
    clone
      .querySelectorAll("button, svg, style, script, [data-testid*='copy'], [aria-label*='复制'], [aria-label*='Copy'], .sr-only")
      .forEach((node) => node.remove());
    return clone;
  }

  function inlineCode(text) {
    const value = text.trim();
    const fence = value.includes("`") ? "``" : "`";
    return `${fence}${value}${fence}`;
  }

  function tableToMarkdown(table) {
    const rows = [...table.querySelectorAll("tr")].map((row) =>
      [...row.querySelectorAll("th, td")].map((cell) => cell.innerText.trim().replaceAll("|", "\\|")),
    );
    if (!rows.length) return "";

    const width = Math.max(...rows.map((row) => row.length));
    const normalized = rows.map((row) => [...row, ...Array(width - row.length).fill("")]);
    const header = normalized[0];
    return `\n\n| ${header.join(" | ")} |\n| ${header.map(() => "---").join(" | ")} |\n${normalized
      .slice(1)
      .map((row) => `| ${row.join(" | ")} |`)
      .join("\n")}\n\n`;
  }

  function nodeToMarkdown(node, listDepth = 0) {
    if (node.nodeType === Node.TEXT_NODE) return node.textContent || "";
    if (node.nodeType !== Node.ELEMENT_NODE) return "";

    const tag = node.tagName.toLowerCase();
    const children = () => [...node.childNodes].map((child) => nodeToMarkdown(child, listDepth)).join("");

    if (node.classList.contains("katex")) {
      const tex = node.querySelector("annotation[encoding='application/x-tex']")?.textContent?.trim();
      if (tex) {
        const display = Boolean(node.closest(".katex-display"));
        return display ? `\n\n$$\n${tex}\n$$\n\n` : `$${tex}$`;
      }
    }

    if (tag === "pre") {
      const code = node.querySelector("code");
      const language = code?.className.match(/language-([\w+-]+)/)?.[1] || "";
      const text = (code?.innerText || node.innerText || "").replace(/\n$/, "");
      return `\n\n\`\`\`${language}\n${text}\n\`\`\`\n\n`;
    }
    if (tag === "code") return inlineCode(node.textContent || "");
    if (tag === "br") return "\n";
    if (tag === "hr") return "\n\n---\n\n";
    if (tag === "strong" || tag === "b") return `**${children().trim()}**`;
    if (tag === "em" || tag === "i") return `*${children().trim()}*`;
    if (tag === "del" || tag === "s") return `~~${children().trim()}~~`;
    if (tag === "a") return `[${children().trim() || node.href}](${node.href})`;
    if (/^h[1-6]$/.test(tag)) return `\n\n${"#".repeat(Number(tag[1]))} ${children().trim()}\n\n`;
    if (tag === "blockquote") {
      return `\n\n${children().trim().split("\n").map((line) => `> ${line}`).join("\n")}\n\n`;
    }
    if (tag === "table") return tableToMarkdown(node);
    if (tag === "ul" || tag === "ol") {
      const ordered = tag === "ol";
      const items = [...node.children]
        .filter((child) => child.tagName.toLowerCase() === "li")
        .map((child, index) => {
          const marker = ordered ? `${index + 1}.` : "-";
          const value = nodeToMarkdown(child, listDepth + 1).trim();
          return `${"  ".repeat(listDepth)}${marker} ${value}`;
        });
      return `\n${items.join("\n")}\n`;
    }
    if (tag === "li") return children();
    if (["p", "section", "article"].includes(tag)) return `\n\n${children().trim()}\n\n`;

    return children();
  }

  function messageContent(node, role) {
    const content =
      role === "assistant"
        ? node.querySelector(".markdown, [class*='markdown']") || node
        : node.querySelector("[class*='whitespace-pre-wrap']") || node;
    return nodeToMarkdown(cleanClone(content))
      .replace(/\u00a0/g, " ")
      .replace(/[ \t]+\n/g, "\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim();
  }

  function roleFromArticle(article) {
    const roleNode = article.querySelector("[data-message-author-role]");
    const explicitRole = roleNode?.getAttribute("data-message-author-role");
    if (explicitRole === "user" || explicitRole === "assistant") return explicitRole;

    const label = [
      article.getAttribute("aria-label"),
      article.getAttribute("data-testid"),
      article.querySelector("h5, h6, [class*='sr-only']")?.textContent,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();

    if (/user|you said|你说|用户/.test(label)) return "user";
    if (/assistant|chatgpt said|chatgpt|助手/.test(label)) return "assistant";
    return "";
  }

  function conversationNodes() {
    const articles = [...document.querySelectorAll("article[data-testid^='conversation-turn'], article[data-scroll-anchor]")];
    if (articles.length) {
      return articles
        .map((article) => {
          const role = roleFromArticle(article);
          if (!role) return null;
          const roleNode = article.querySelector(`[data-message-author-role='${role}']`);
          const testId = article.getAttribute("data-testid") || "";
          const turnIndex = Number(testId.match(/conversation-turn-(\d+)/)?.[1]);
          const messageId =
            roleNode?.getAttribute("data-message-id") || article.querySelector("[data-message-id]")?.getAttribute("data-message-id") || "";
          return { messageId, node: roleNode || article, role, turnIndex: Number.isFinite(turnIndex) ? turnIndex : null };
        })
        .filter(Boolean);
    }

    return [...document.querySelectorAll("[data-message-author-role]")]
      .filter((node) => !node.parentElement?.closest("[data-message-author-role]"))
      .map((node) => {
        const article = node.closest("article[data-testid^='conversation-turn']");
        const turnIndex = Number(article?.getAttribute("data-testid")?.match(/conversation-turn-(\d+)/)?.[1]);
        return {
          messageId: node.getAttribute("data-message-id") || "",
          node,
          role: node.getAttribute("data-message-author-role"),
          turnIndex: Number.isFinite(turnIndex) ? turnIndex : null,
        };
      })
      .filter(({ role }) => role === "user" || role === "assistant");
  }

  function extractConversation() {
    const id = conversationId();
    if (state.cacheConversationId !== id) {
      state.cacheConversationId = id;
      state.cacheSequence = 0;
      state.messageCache.clear();
    }

    const visibleMessages = conversationNodes()
      .map(({ messageId, node, role, turnIndex }) => {
        return { content: messageContent(node, role), messageId, role, turnIndex };
      })
      .filter((message) => message?.content);

    for (const message of visibleMessages) {
      const key = message.turnIndex !== null ? `turn:${message.turnIndex}` : message.messageId || `${message.role}:${message.content}`;
      const previous = state.messageCache.get(key);
      state.messageCache.set(key, { ...message, seenOrder: previous?.seenOrder ?? state.cacheSequence++ });
    }

    const messages = [...state.messageCache.values()]
      .sort((left, right) => {
        if (left.turnIndex !== null && right.turnIndex !== null) return left.turnIndex - right.turnIndex;
        return left.seenOrder - right.seenOrder;
      })
      .map(({ content, messageId, role }) => ({ content, messageId, role }));

    const firstQuestion = messages.find((message) => message.role === "user")?.content || "ChatGPT 对话";
    const pageTitle = document.title.replace(/\s*[-|]\s*ChatGPT\s*$/i, "").trim();
    const title = pageTitle && pageTitle.toLowerCase() !== "chatgpt" ? pageTitle : firstQuestion.split("\n")[0].slice(0, 60);
    const last = messages.at(-1);
    const signature = `${id}:${messages.length}:${last?.role || ""}:${last?.content.length || 0}:${last?.content.slice(-160) || ""}`;

    return {
      payload: {
        conversationId: id,
        createdAt: new Date().toISOString(),
        classificationMode: state.classificationMode,
        fixedCollectionId: state.fixedCollectionId,
        fixedCollectionTitle: state.fixedCollectionTitle,
        libraryName: state.libraryName,
        messages,
        sourceUrl: location.href,
        syncScope: state.syncScope,
        title,
      },
      signature,
    };
  }

  function isGenerating() {
    const hasStopButton = Boolean(
      document.querySelector(
        "button[data-testid='stop-button'], button[aria-label*='Stop'], button[aria-label*='停止'], button[aria-label*='中止']",
      ),
    );
    const hasAnalysisPlaceholder = conversationNodes().some(
      ({ node, role }) => role === "assistant" && /^正在(?:思考|分析)(?:\s*\d*\s*幅?图片)?[.…。]*$/i.test(node.innerText.trim()),
    );
    return hasStopButton || hasAnalysisPlaceholder;
  }

  function sendMessage(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          if (chrome.runtime.lastError) {
            resolve({ ok: false, error: "扩展刚刚更新，请刷新 ChatGPT 页面" });
            return;
          }
          resolve(response || { ok: false, error: "本地服务没有响应" });
        });
      } catch {
        resolve({ ok: false, error: "扩展连接已失效，请刷新页面" });
      }
    });
  }

  const host = document.createElement("div");
  host.id = "job-prep-vuepress-sync";
  const shadow = host.attachShadow({ mode: "open" });
  shadow.innerHTML = `
    <style>
      :host { all: initial; }
      * { box-sizing: border-box; }
      .dock {
        --ink: #1d1d1f;
        --muted: #6e6e73;
        --paper: rgba(250, 250, 252, .82);
        --paper-solid: #f7f7f9;
        --surface: rgba(255, 255, 255, .58);
        --line: rgba(0, 0, 0, .085);
        --accent: #0a84ff;
        --accent-deep: #0066cc;
        --accent-soft: rgba(0, 113, 227, .10);
        --success: #28a563;
        --danger: #e5484d;
        --toast: rgba(29, 29, 31, .94);
        position: fixed;
        right: 22px;
        bottom: 92px;
        z-index: 2147483646;
        color: var(--ink);
        font-family: "SF Pro Text", "SF Pro Display", -apple-system, BlinkMacSystemFont, "PingFang SC", sans-serif;
        transition: right .32s cubic-bezier(.22, 1, .36, 1);
      }
      .bar {
        display: flex;
        overflow: hidden;
        width: 244px;
        min-width: 244px;
        border: 1px solid var(--line);
        border-radius: 20px;
        background: var(--paper);
        box-shadow:
          0 20px 48px rgba(0, 0, 0, .13),
          0 3px 10px rgba(0, 0, 0, .055),
          0 1px 0 rgba(255, 255, 255, .92) inset;
        backdrop-filter: blur(28px) saturate(1.45);
        -webkit-backdrop-filter: blur(28px) saturate(1.45);
        animation: dock-in .42s cubic-bezier(.22, 1, .36, 1) both;
        transition:
          width .32s cubic-bezier(.22, 1, .36, 1),
          min-width .32s cubic-bezier(.22, 1, .36, 1),
          border-radius .32s cubic-bezier(.22, 1, .36, 1),
          transform .2s ease,
          box-shadow .2s ease,
          border-color .2s ease;
      }
      .bar:hover {
        transform: translateY(-2px);
        border-color: rgba(0, 113, 227, .18);
        box-shadow:
          0 24px 56px rgba(0, 0, 0, .16),
          0 5px 12px rgba(0, 0, 0, .06),
          0 1px 0 rgba(255, 255, 255, .94) inset;
      }
      button {
        border: 0;
        color: inherit;
        cursor: pointer;
        -webkit-tap-highlight-color: transparent;
      }
      button:focus-visible {
        outline: 3px solid rgba(10, 132, 255, .26);
        outline-offset: -3px;
      }
      .sync {
        position: relative;
        display: flex;
        flex: 1;
        gap: 10px;
        align-items: center;
        min-height: 56px;
        padding: 8px 14px 8px 9px;
        overflow: hidden;
        background: transparent;
        text-align: left;
      }
      .sync::after {
        position: absolute;
        inset: 0;
        background: linear-gradient(105deg, transparent 25%, rgba(201, 98, 67, .08), transparent 75%);
        content: "";
        opacity: 0;
        transform: translateX(-55%);
        transition: opacity .2s ease, transform .45s ease;
        pointer-events: none;
      }
      .sync:hover::after { opacity: 1; transform: translateX(55%); }
      .sync:active { transform: translateY(1px); }
      .sync:disabled { cursor: wait; opacity: .68; }
      .mark-box {
        position: relative;
        display: grid;
        flex: 0 0 38px;
        width: 38px;
        height: 38px;
        place-items: center;
        border: 1px solid rgba(255, 255, 255, .42);
        border-radius: 50%;
        background: linear-gradient(145deg, #e98a63 0%, #c96243 56%, #a84732 100%);
        color: #fff8ee;
        box-shadow: 0 8px 20px rgba(143, 62, 42, .28), 0 1px 0 rgba(255, 255, 255, .38) inset;
        transition:
          width .32s cubic-bezier(.22, 1, .36, 1),
          height .32s cubic-bezier(.22, 1, .36, 1),
          transform .24s cubic-bezier(.2, .8, .2, 1),
          filter .2s ease;
      }
      .mark {
        width: 20px;
        height: 20px;
        overflow: visible;
        opacity: 1;
        transition: opacity .18s ease, transform .24s cubic-bezier(.2, .8, .2, 1);
      }
      .status-symbol {
        position: absolute;
        width: 19px;
        height: 19px;
        opacity: 0;
        transform: scale(.64);
        transition: opacity .18s ease, transform .26s cubic-bezier(.2, .9, .2, 1);
      }
      .status-dot {
        position: absolute;
        top: -2px;
        right: -2px;
        width: 9px;
        height: 9px;
        border: 2px solid var(--paper-solid);
        border-radius: 50%;
        background: #ff9f0a;
        box-shadow: 0 2px 7px rgba(180, 91, 0, .35);
        opacity: 0;
        transform: scale(.5);
        transition: opacity .18s ease, transform .24s cubic-bezier(.2, .9, .2, 1);
      }
      .dock[data-status="pending"] .status-dot {
        opacity: 1;
        transform: scale(1);
      }
      .dock[data-status="syncing"] .mark-box::before {
        position: absolute;
        inset: -4px;
        border: 2px solid rgba(201, 98, 67, .18);
        border-top-color: #e98a63;
        border-radius: 50%;
        content: "";
        animation: status-spin .8s linear infinite;
      }
      .dock[data-status="syncing"] .mark { animation: status-breathe 1.1s ease-in-out infinite; }
      .dock[data-status="syncing"] .sync:disabled .mark-box { animation: none; }
      .dock[data-status="success"] .mark-box {
        background: linear-gradient(145deg, #4cc878, #238c55);
        box-shadow: 0 8px 20px rgba(35, 140, 85, .28), 0 1px 0 rgba(255, 255, 255, .38) inset;
      }
      .dock[data-status="error"] .mark-box {
        background: linear-gradient(145deg, #ec6a62, #bc3f3a);
        box-shadow: 0 8px 20px rgba(188, 63, 58, .26), 0 1px 0 rgba(255, 255, 255, .35) inset;
      }
      .dock[data-status="success"] .mark,
      .dock[data-status="error"] .mark { opacity: 0; transform: scale(.72); }
      .dock[data-status="success"] .status-success,
      .dock[data-status="error"] .status-error { opacity: 1; transform: scale(1); }
      .sync:hover .mark-box { transform: scale(1.045); filter: brightness(1.04); }
      .sync:disabled .mark-box { animation: breathe 1.1s ease-in-out infinite; }
      .sync-copy {
        display: grid;
        gap: 3px;
        min-width: 96px;
        overflow: hidden;
        opacity: 1;
        transition: min-width .24s ease, opacity .16s ease;
      }
      .sync-label {
        max-width: 122px;
        overflow: hidden;
        font: 650 13px/1.08 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        letter-spacing: -.01em;
        text-overflow: ellipsis;
        white-space: nowrap;
      }
      .sync-meta {
        color: var(--muted);
        font: 500 9px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        letter-spacing: .04em;
        white-space: nowrap;
      }
      .pin,
      .options {
        position: relative;
        display: grid;
        place-items: center;
        background: transparent;
        color: var(--muted);
        opacity: 1;
        overflow: hidden;
        transition: flex-basis .24s ease, width .24s ease, opacity .14s ease, color .18s ease, background .18s ease;
      }
      .pin {
        flex: 0 0 34px;
        width: 34px;
      }
      .options {
        flex: 0 0 42px;
        width: 42px;
      }
      .options::before {
        position: absolute;
        left: 0;
        width: 1px;
        height: 24px;
        background: var(--line);
        content: "";
      }
      .options svg { width: 18px; height: 18px; transition: transform .22s ease; }
      .pin svg { width: 16px; height: 16px; transition: transform .24s cubic-bezier(.2, .8, .2, 1); }
      .pin:hover,
      .options:hover { background: rgba(0, 0, 0, .035); color: var(--ink); }
      .pin[aria-pressed="true"] { background: rgba(201, 98, 67, .11); color: #b24f35; }
      .pin[aria-pressed="true"] svg { transform: rotate(-36deg); }
      .options[aria-expanded="true"] { background: var(--accent-soft); color: var(--accent-deep); }
      .options[aria-expanded="true"] svg { transform: rotate(90deg); }
      .dock.is-idle { right: 6px; }
      .dock.is-idle .bar {
        width: 48px;
        min-width: 48px;
        border-radius: 50%;
        box-shadow:
          0 14px 34px rgba(0, 0, 0, .14),
          0 2px 8px rgba(0, 0, 0, .06),
          0 1px 0 rgba(255, 255, 255, .9) inset;
      }
      .dock.is-idle .bar:hover { transform: none; }
      .dock.is-idle .sync {
        flex: 0 0 48px;
        width: 48px;
        min-height: 48px;
        gap: 0;
        padding: 7px;
      }
      .dock.is-idle .mark-box {
        flex-basis: 34px;
        width: 34px;
        height: 34px;
        box-shadow: 0 7px 17px rgba(143, 62, 42, .3), 0 1px 0 rgba(255, 255, 255, .4) inset;
      }
      .dock.is-idle .mark { width: 18px; height: 18px; }
      .dock.is-idle .sync-copy {
        min-width: 0;
        width: 0;
        opacity: 0;
      }
      .dock.is-idle .pin,
      .dock.is-idle .options {
        flex-basis: 0;
        width: 0;
        opacity: 0;
        pointer-events: none;
      }
      .dock.is-idle .options::before { opacity: 0; }
      .panel {
        position: absolute;
        right: 0;
        bottom: 66px;
        width: 312px;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--paper);
        box-shadow: 0 28px 70px rgba(0, 0, 0, .16), 0 1px 0 rgba(255, 255, 255, .9) inset;
        backdrop-filter: blur(32px) saturate(1.45);
        -webkit-backdrop-filter: blur(32px) saturate(1.45);
        animation: rise .24s cubic-bezier(.22, 1, .36, 1);
      }
      .panel::after {
        position: absolute;
        right: 17px;
        bottom: -6px;
        width: 12px;
        height: 12px;
        border-right: 1px solid var(--line);
        border-bottom: 1px solid var(--line);
        background: var(--paper-solid);
        content: "";
        transform: rotate(45deg);
      }
      .panel[hidden] { display: none; }
      .panel-head { display: flex; align-items: center; justify-content: space-between; }
      .eyebrow { color: var(--muted); font: 600 9px/1 "SF Pro Text", -apple-system, sans-serif; letter-spacing: .11em; }
      .local-badge { padding: 4px 7px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-deep); font: 650 8px/1 "SF Pro Text", -apple-system, sans-serif; letter-spacing: .04em; }
      .profile-switcher {
        display: grid;
        grid-template-columns: minmax(0, 1fr) auto;
        gap: 7px;
        align-items: end;
        margin-top: 17px;
      }
      .profile-switcher label { display: grid; gap: 6px; color: var(--muted); font-size: 10px; font-weight: 500; }
      .profile-select {
        min-width: 0;
        width: 100%;
        height: 38px;
        padding: 0 30px 0 10px;
        border: 1px solid var(--line);
        border-radius: 11px;
        outline: none;
        background: var(--surface);
        color: var(--ink);
        font: 650 11px/1.2 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .profile-select:focus { border-color: rgba(10, 132, 255, .5); box-shadow: 0 0 0 3px rgba(10, 132, 255, .12); }
      .manage-profiles {
        height: 38px;
        padding: 0 9px;
        border: 1px solid var(--line);
        border-radius: 11px;
        background: var(--surface);
        color: var(--muted);
        font-size: 9px;
        font-weight: 650;
      }
      .manage-profiles:hover { color: var(--accent-deep); }
      .name-editor { display: grid; gap: 6px; margin: 17px 0 13px; color: var(--muted); font-size: 10px; font-weight: 500; cursor: text; }
      .name-input-row {
        display: flex;
        align-items: center;
        padding: 9px 11px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: var(--surface);
        box-shadow: 0 1px 0 rgba(255, 255, 255, .72) inset;
        transition: border-color .18s ease, box-shadow .18s ease, background .18s ease;
      }
      .name-editor:focus-within .name-input-row { border-color: rgba(10, 132, 255, .5); background: rgba(255, 255, 255, .78); box-shadow: 0 0 0 3px rgba(10, 132, 255, .12); }
      .library-name {
        min-width: 0;
        width: 100%;
        padding: 0;
        border: 0;
        outline: 0;
        background: transparent;
        color: var(--ink);
        font: 650 16px/1.25 "SF Pro Display", -apple-system, "PingFang SC", sans-serif;
        letter-spacing: -.02em;
      }
      .name-input-row svg { flex: 0 0 16px; width: 16px; height: 16px; color: var(--muted); }
      .service {
        display: flex;
        gap: 8px;
        align-items: center;
        margin-bottom: 10px;
        padding: 10px 11px;
        border: 1px solid var(--line);
        border-radius: 12px;
        background: var(--surface);
        color: var(--muted);
        font-size: 11px;
      }
      .service > span { flex: 1; min-width: 0; }
      .service-settings {
        flex: 0 0 auto;
        padding: 3px 0 3px 8px;
        border-left: 1px solid var(--line);
        background: transparent;
        color: var(--accent-deep);
        font: 650 9px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .service-settings:hover { text-decoration: underline; text-underline-offset: 2px; }
      .dot { width: 7px; height: 7px; border-radius: 50%; background: #aaa397; box-shadow: 0 0 0 3px rgba(170, 163, 151, .14); }
      .dot.online { background: var(--success); box-shadow: 0 0 0 3px rgba(39, 132, 85, .13); }
      .dot.offline { background: var(--danger); box-shadow: 0 0 0 3px rgba(179, 77, 65, .13); }
      .auto-row {
        display: flex;
        gap: 12px;
        align-items: center;
        justify-content: space-between;
        padding: 10px 11px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: var(--surface);
        color: var(--ink);
        font-size: 12px;
        line-height: 1.45;
        cursor: pointer;
      }
      .auto {
        position: relative;
        flex: 0 0 40px;
        width: 40px;
        height: 24px;
        margin: 0;
        appearance: none;
        border: 1px solid var(--line);
        border-radius: 999px;
        background: rgba(120, 120, 128, .2);
        cursor: pointer;
        transition: background .2s ease, border-color .2s ease;
      }
      .auto::after {
        position: absolute;
        top: 3px;
        left: 3px;
        width: 16px;
        height: 16px;
        border-radius: 50%;
        background: #fff;
        box-shadow: 0 2px 5px rgba(0, 0, 0, .25);
        content: "";
        transition: transform .22s cubic-bezier(.2, .8, .2, 1);
      }
      .auto:checked { border-color: #30a957; background: #34c759; }
      .auto:checked::after { transform: translateX(16px); }
      .auto:focus-visible { outline: 3px solid rgba(10, 132, 255, .22); outline-offset: 2px; }
      .verify-row {
        display: flex;
        gap: 10px;
        align-items: center;
        justify-content: space-between;
        margin-top: 10px;
        padding: 10px 10px 10px 11px;
        border: 1px solid var(--line);
        border-radius: 13px;
        background: var(--surface);
      }
      .verify-copy { display: grid; gap: 3px; min-width: 0; }
      .verify-copy strong { color: var(--ink); font-size: 11px; font-weight: 650; line-height: 1.25; }
      .verify-copy small { color: var(--muted); font-size: 8px; line-height: 1.25; white-space: nowrap; }
      .verify-last {
        display: flex;
        flex: 0 0 auto;
        gap: 5px;
        align-items: center;
        min-height: 30px;
        padding: 0 9px;
        border: 1px solid rgba(201, 98, 67, .24);
        border-radius: 9px;
        background: rgba(201, 98, 67, .09);
        color: #a84732;
        font: 650 9px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        transition: transform .18s ease, background .18s ease, border-color .18s ease;
      }
      .verify-last:hover { border-color: rgba(201, 98, 67, .38); background: rgba(201, 98, 67, .15); transform: translateY(-1px); }
      .verify-last:disabled { cursor: wait; opacity: .62; transform: none; }
      .verify-last svg { width: 12px; height: 12px; }
      .verify-last:disabled svg { animation: verify-spin .8s linear infinite; }
      .routing {
        display: grid;
        gap: 9px;
        margin-bottom: 10px;
        padding: 11px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
      }
      .setting-caption { color: var(--muted); font-size: 10px; font-weight: 600; }
      .mode-control {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        padding: 3px;
        border-radius: 11px;
        background: rgba(120, 120, 128, .12);
      }
      .mode-button {
        min-height: 29px;
        border-radius: 8px;
        background: transparent;
        color: var(--muted);
        font: 600 11px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        transition: color .18s ease, background .18s ease, box-shadow .18s ease;
      }
      .mode-button:hover { color: var(--ink); }
      .mode-button[aria-pressed="true"] {
        background: var(--paper-solid);
        color: var(--ink);
        box-shadow: 0 1px 4px rgba(0, 0, 0, .1), 0 1px 0 rgba(255, 255, 255, .72) inset;
      }
      .collection-picker { position: relative; display: block; }
      .collection-picker[hidden] { display: none; }
      .collection-select {
        width: 100%;
        min-height: 34px;
        padding: 0 30px 0 10px;
        appearance: none;
        border: 1px solid var(--line);
        border-radius: 10px;
        outline: 0;
        background: var(--paper-solid);
        color: var(--ink);
        font: 550 11px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .collection-picker::after {
        position: absolute;
        top: 50%;
        right: 11px;
        width: 6px;
        height: 6px;
        border-right: 1.5px solid var(--muted);
        border-bottom: 1.5px solid var(--muted);
        content: "";
        pointer-events: none;
        transform: translateY(-65%) rotate(45deg);
      }
      .collection-select:focus { border-color: rgba(10, 132, 255, .5); box-shadow: 0 0 0 3px rgba(10, 132, 255, .12); }
      .collection-tools { display: flex; justify-content: flex-end; gap: 12px; }
      .collection-tool {
        padding: 0;
        background: transparent;
        color: var(--accent-deep);
        font: 600 10px/1.2 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .collection-tool:hover { text-decoration: underline; text-underline-offset: 2px; }
      .routing-note { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.45; }
      .scope-setting {
        display: grid;
        gap: 8px;
        margin-bottom: 10px;
        padding: 11px;
        border: 1px solid var(--line);
        border-radius: 14px;
        background: var(--surface);
      }
      .scope-control {
        display: grid;
        grid-template-columns: 1fr 1fr;
        gap: 3px;
        padding: 3px;
        border-radius: 11px;
        background: rgba(120, 120, 128, .12);
      }
      .scope-button {
        min-height: 29px;
        border-radius: 8px;
        background: transparent;
        color: var(--muted);
        font: 600 11px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        transition: color .18s ease, background .18s ease, box-shadow .18s ease;
      }
      .scope-button:hover { color: var(--ink); }
      .scope-button[aria-pressed="true"] {
        background: var(--paper-solid);
        color: var(--ink);
        box-shadow: 0 1px 4px rgba(0, 0, 0, .1), 0 1px 0 rgba(255, 255, 255, .72) inset;
      }
      .scope-note { margin: 0; color: var(--muted); font-size: 9px; line-height: 1.45; }
      .collection-dialog {
        position: absolute;
        right: 0;
        bottom: 66px;
        width: 312px;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 22px;
        background: var(--paper);
        box-shadow: 0 28px 70px rgba(0, 0, 0, .16), 0 1px 0 rgba(255, 255, 255, .9) inset;
        backdrop-filter: blur(32px) saturate(1.45);
        -webkit-backdrop-filter: blur(32px) saturate(1.45);
        animation: rise .24s cubic-bezier(.22, 1, .36, 1);
      }
      .collection-dialog[hidden] { display: none; }
      .collection-dialog h3 {
        margin: 6px 0 7px;
        font: 650 20px/1.25 "SF Pro Display", -apple-system, "PingFang SC", sans-serif;
        letter-spacing: -.025em;
      }
      .collection-dialog p { margin: 0 0 14px; color: var(--muted); font-size: 10px; line-height: 1.5; }
      .collection-name-input {
        width: 100%;
        min-height: 40px;
        padding: 0 11px;
        border: 1px solid var(--line);
        border-radius: 11px;
        outline: 0;
        background: var(--surface);
        color: var(--ink);
        font: 600 13px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .collection-name-input:focus { border-color: rgba(10, 132, 255, .5); box-shadow: 0 0 0 3px rgba(10, 132, 255, .12); }
      .collection-dialog-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 15px; }
      .collection-dialog-actions button {
        min-height: 34px;
        padding: 0 13px;
        border: 1px solid var(--line);
        border-radius: 10px;
        background: var(--surface);
        font: 600 11px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
      }
      .collection-dialog-actions .save-collection { border-color: var(--accent-deep); background: var(--accent-deep); color: #fff; }
      .collection-dialog-actions .save-collection:disabled { cursor: wait; opacity: .6; }
      .hint { margin: 14px 2px 0; padding-top: 12px; border-top: 1px solid var(--line); color: var(--muted); font-size: 10px; line-height: 1.6; }
      .duplicate-dialog {
        position: absolute;
        right: 0;
        bottom: 66px;
        width: 510px;
        padding: 20px;
        border: 1px solid var(--line);
        border-radius: 24px;
        background: var(--paper);
        box-shadow: 0 32px 80px rgba(0, 0, 0, .18), 0 1px 0 rgba(255, 255, 255, .9) inset;
        backdrop-filter: blur(32px) saturate(1.45);
        -webkit-backdrop-filter: blur(32px) saturate(1.45);
        animation: rise .25s cubic-bezier(.22, 1, .36, 1);
      }
      .duplicate-dialog[hidden] { display: none; }
      .duplicate-top { display: flex; align-items: flex-start; justify-content: space-between; gap: 16px; }
      .duplicate-kicker { margin-bottom: 6px; color: var(--accent-deep); font: 650 9px/1 "SF Pro Text", -apple-system, sans-serif; letter-spacing: .1em; }
      .duplicate-dialog h3 { margin: 0; font: 650 20px/1.3 "SF Pro Display", -apple-system, "PingFang SC", sans-serif; letter-spacing: -.025em; }
      .duplicate-count { flex: 0 0 auto; padding: 5px 8px; border-radius: 999px; background: var(--accent-soft); color: var(--accent-deep); font: 650 9px/1 "SF Pro Text", -apple-system, sans-serif; }
      .duplicate-question { margin: 14px 0; color: var(--ink); font-size: 12px; font-weight: 650; line-height: 1.55; }
      .duplicate-answer-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 10px; }
      .answer-choice { min-width: 0; padding: 12px; border: 1px solid var(--line); border-radius: 15px; background: var(--surface); }
      .answer-choice.new { border-color: rgba(10, 132, 255, .27); background: rgba(10, 132, 255, .065); }
      .answer-label { display: flex; align-items: center; gap: 6px; margin-bottom: 8px; color: var(--muted); font-size: 10px; font-weight: 700; }
      .answer-label::before { width: 6px; height: 6px; border-radius: 50%; background: #999187; content: ""; }
      .answer-choice.new .answer-label::before { background: var(--accent); }
      .answer-preview {
        max-height: 128px;
        margin: 0;
        overflow: auto;
        color: var(--ink);
        font: 11px/1.6 "SF Pro Text", -apple-system, "PingFang SC", sans-serif;
        white-space: pre-wrap;
        word-break: break-word;
      }
      .duplicate-actions { display: flex; gap: 8px; justify-content: flex-end; margin-top: 16px; }
      .duplicate-actions button { min-height: 34px; padding: 0 12px; border: 1px solid var(--line); border-radius: 11px; background: var(--surface); font: 600 11px/1 "SF Pro Text", -apple-system, "PingFang SC", sans-serif; transition: transform .16s ease, background .16s ease; }
      .duplicate-actions button:hover { transform: translateY(-1px); background: rgba(120, 120, 128, .10); }
      .duplicate-actions .use-new { border-color: var(--accent-deep); background: var(--accent-deep); color: #fff; }
      .duplicate-actions .use-new:hover { background: #0077ed; }
      .duplicate-actions .cancel { margin-right: auto; color: var(--muted); }
      .toast {
        position: absolute;
        right: 0;
        bottom: 66px;
        display: flex;
        gap: 12px;
        align-items: center;
        max-width: 360px;
        padding: 12px 15px;
        border: 1px solid rgba(255, 255, 255, .12);
        border-radius: 14px;
        background: var(--toast);
        color: #fff;
        box-shadow: 0 16px 40px rgba(0, 0, 0, .22);
        font-size: 11px;
        line-height: 1.4;
        animation: rise .24s cubic-bezier(.22, 1, .36, 1);
      }
      .toast-copy { white-space: nowrap; }
      .toast-action {
        flex: 0 0 auto;
        padding-left: 12px;
        border-left: 1px solid rgba(255, 255, 255, .2);
        color: #7dc1ff;
        font-weight: 650;
        text-decoration: none;
        white-space: nowrap;
      }
      .toast-action:hover { color: #fff; }
      .toast-action[hidden] { display: none; }
      .toast.error { background: rgba(179, 38, 30, .94); }
      .toast[hidden] { display: none; }
      @keyframes dock-in { from { opacity: 0; transform: translateY(10px) scale(.96); } }
      @keyframes rise { from { opacity: 0; transform: translateY(9px) scale(.97); } }
      @keyframes breathe { 50% { transform: scale(.92); opacity: .72; } }
      @keyframes status-spin { to { transform: rotate(360deg); } }
      @keyframes status-breathe { 50% { transform: scale(.88); opacity: .7; } }
      @keyframes verify-spin { to { transform: rotate(360deg); } }
      :host([data-theme="dark"]) .dock {
        --ink: #f5f5f7;
        --muted: #a1a1a6;
        --paper: rgba(34, 34, 36, .82);
        --paper-solid: #242426;
        --surface: rgba(255, 255, 255, .065);
        --line: rgba(255, 255, 255, .11);
        --accent: #0a84ff;
        --accent-deep: #2997ff;
        --accent-soft: rgba(10, 132, 255, .16);
        --toast: rgba(245, 245, 247, .95);
      }
      :host([data-theme="dark"]) .bar,
      :host([data-theme="dark"]) .panel,
      :host([data-theme="dark"]) .duplicate-dialog,
      :host([data-theme="dark"]) .collection-dialog { box-shadow: 0 22px 56px rgba(0, 0, 0, .34), 0 1px 0 rgba(255, 255, 255, .06) inset; }
      :host([data-theme="dark"]) .name-editor:focus-within .name-input-row { background: rgba(255, 255, 255, .1); }
      :host([data-theme="dark"]) .mode-button[aria-pressed="true"],
      :host([data-theme="dark"]) .scope-button[aria-pressed="true"],
      :host([data-theme="dark"]) .collection-select { background: rgba(255, 255, 255, .11); }
      :host([data-theme="dark"]) .toast { color: #1d1d1f; }
      :host([data-theme="dark"]) .toast-action { border-left-color: rgba(0, 0, 0, .15); color: #0066cc; }
      :host([data-theme="dark"]) .toast.error { color: #fff8ef; }
      @media (max-width: 720px) {
        .dock { right: 10px; bottom: 76px; }
        .dock.is-idle { right: 6px; }
        .bar { width: 124px; min-width: 124px; }
        .sync { padding-right: 9px; }
        .sync-copy { display: none; }
        .duplicate-dialog { right: 0; width: min(510px, calc(100vw - 20px)); max-height: 70vh; overflow: auto; }
        .duplicate-answer-grid { grid-template-columns: 1fr; }
        .duplicate-actions { flex-wrap: wrap; }
      }
      @media (prefers-reduced-motion: reduce) {
        .dock, .bar, .panel, .toast, .mark-box, .mark, .status-symbol, .status-dot, .sync-copy, .pin, .options {
          animation: none;
          transition: none;
        }
      }
    </style>
    <div class="dock" data-status="idle">
      <div class="toast" role="status" aria-live="polite" hidden><span class="toast-copy"></span><a class="toast-action" target="_blank" rel="noopener noreferrer" hidden>查看笔记</a></div>
      <section class="duplicate-dialog" role="dialog" aria-modal="true" aria-labelledby="duplicate-title" hidden>
        <div class="duplicate-top">
          <div><div class="duplicate-kicker">DUPLICATE QUESTION</div><h3 id="duplicate-title">这道题已经收录过</h3></div>
          <span class="duplicate-count"></span>
        </div>
        <p class="duplicate-question"></p>
        <div class="duplicate-answer-grid">
          <article class="answer-choice existing"><div class="answer-label">知识库现有答案</div><pre class="answer-preview"></pre></article>
          <article class="answer-choice new"><div class="answer-label">本次 ChatGPT 答案</div><pre class="answer-preview"></pre></article>
        </div>
        <div class="duplicate-actions">
          <button class="cancel" type="button">取消同步</button>
          <button class="keep-existing" type="button">保留现有答案</button>
          <button class="use-new" type="button">使用本次答案</button>
        </div>
      </section>
      <section class="collection-dialog" role="dialog" aria-modal="true" aria-labelledby="collection-dialog-title" hidden>
        <div class="eyebrow">ORGANIZE LIBRARY</div>
        <h3 id="collection-dialog-title">新建分类</h3>
        <p class="collection-dialog-copy">创建后会自动设为后续问题的固定分类。</p>
        <input class="collection-name-input" type="text" maxlength="40" placeholder="例如：系统设计专题" aria-label="分类名称">
        <div class="collection-dialog-actions">
          <button class="cancel-collection" type="button">取消</button>
          <button class="save-collection" type="button">创建分类</button>
        </div>
      </section>
      <section class="panel" aria-label="同步设置" hidden>
        <div class="panel-head"><div class="eyebrow">KNOWLEDGE BASE</div><span class="local-badge">ON DEVICE</span></div>
        <div class="profile-switcher">
          <label><span>当前知识库档案</span><select class="profile-select" aria-label="切换知识库档案"><option>正在读取档案…</option></select></label>
          <button class="manage-profiles" type="button">管理</button>
        </div>
        <label class="name-editor">
          <span>知识库名称</span>
          <span class="name-input-row"><input class="library-name" type="text" maxlength="24" value="我的知识库" aria-label="知识库名称"><svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m14.7 5.3 4 4M5 19l3.6-.7L18 8.9a1.4 1.4 0 0 0 0-2L17.1 6a1.4 1.4 0 0 0-2 0l-9.4 9.4L5 19Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></span>
        </label>
        <div class="service"><i class="dot"></i><span>正在检查本地服务…</span><button class="service-settings" type="button">API 设置</button></div>
        <div class="routing">
          <span class="setting-caption">后续问题归档</span>
          <div class="mode-control" role="group" aria-label="问题分类方式">
            <button class="mode-button" type="button" data-mode="llm" aria-pressed="true">智能判断</button>
            <button class="mode-button" type="button" data-mode="fixed" aria-pressed="false">固定分类</button>
          </div>
          <label class="collection-picker" hidden>
            <select class="collection-select" aria-label="默认归属分类"><option value="">正在读取分类…</option></select>
          </label>
          <div class="collection-tools">
            <button class="collection-tool create-collection" type="button">＋ 新建分类</button>
            <button class="collection-tool rename-collection" type="button">重命名</button>
          </div>
          <p class="routing-note">LLM 会查看现有分类并自主选择，必要时创建新分类。</p>
        </div>
        <div class="scope-setting">
          <span class="setting-caption">同步范围</span>
          <div class="scope-control" role="group" aria-label="同步范围">
            <button class="scope-button" type="button" data-scope="last" aria-pressed="true">只同步最后一题</button>
            <button class="scope-button" type="button" data-scope="conversation" aria-pressed="false">全部新题</button>
          </div>
          <p class="scope-note">仅发送最近一组完整问答，适合较长的对话。</p>
        </div>
        <label class="auto-row"><span>回答完成后自动同步</span><input class="auto" type="checkbox"></label>
        <div class="verify-row">
          <span class="verify-copy"><strong>最后一题完整性</strong><small>只读核验，不会重复写入</small></span>
          <button class="verify-last" type="button">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20 11a8 8 0 1 1-2.34-5.66M20 4v7h-7" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <span>再次检查</span>
          </button>
        </div>
        <p class="hint">只读取当前页面中已经显示的问答，不读取账号、Cookie 或密码。手动同步始终可用。</p>
      </section>
      <div class="bar">
        <button class="sync" type="button" title="把当前完整对话同步到 VuePress">
          <span class="mark-box">
            <svg class="mark" viewBox="0 0 32 32" fill="none" aria-hidden="true">
              <g stroke="currentColor" stroke-width="4.4" stroke-linecap="round">
                <path d="M16 4.5v7"/>
                <path d="M16 20.5v7"/>
                <path d="m6.04 10.25 6.06 3.5"/>
                <path d="m19.9 18.25 6.06 3.5"/>
                <path d="m25.96 10.25-6.06 3.5"/>
                <path d="m12.1 18.25-6.06 3.5"/>
              </g>
              <circle cx="16" cy="16" r="2.3" fill="currentColor"/>
            </svg>
            <svg class="status-symbol status-success" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="m5 12.5 4.2 4.2L19 7.5" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"/></svg>
            <svg class="status-symbol status-error" viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M12 6.5v6.2M12 17.5h.01" stroke="currentColor" stroke-width="2.5" stroke-linecap="round"/></svg>
            <i class="status-dot" aria-hidden="true"></i>
          </span>
          <span class="sync-copy"><strong class="sync-label">我的知识库</strong><small class="sync-meta">智能分类</small></span>
        </button>
        <button class="pin" type="button" title="固定展开" aria-label="固定展开" aria-pressed="false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M9 3h6l-.8 5.2 3.3 3.3V13H13v7l-1 2-1-2v-7H6.5v-1.5l3.3-3.3L9 3Z" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>
        </button>
        <button class="options" type="button" title="同步设置" aria-label="同步设置" aria-expanded="false">
          <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><circle cx="12" cy="5" r="1.45" fill="currentColor"/><circle cx="12" cy="12" r="1.45" fill="currentColor"/><circle cx="12" cy="19" r="1.45" fill="currentColor"/></svg>
        </button>
      </div>
    </div>`;
  const darkMedia = window.matchMedia("(prefers-color-scheme: dark)");
  function syncDockTheme() {
    const pageTheme = `${document.documentElement.dataset.colorScheme || ""} ${document.documentElement.className || ""} ${document.documentElement.style.colorScheme || ""}`;
    host.dataset.theme = /dark/i.test(pageTheme) || (!/light/i.test(pageTheme) && darkMedia.matches) ? "dark" : "light";
  }
  syncDockTheme();
  new MutationObserver(syncDockTheme).observe(document.documentElement, {
    attributeFilter: ["class", "data-color-scheme", "style"],
    attributes: true,
  });
  darkMedia.addEventListener?.("change", syncDockTheme);
  document.documentElement.append(host);

  const syncButton = shadow.querySelector(".sync");
  const syncLabel = shadow.querySelector(".sync-label");
  const syncMeta = shadow.querySelector(".sync-meta");
  const dock = shadow.querySelector(".dock");
  const pinButton = shadow.querySelector(".pin");
  const libraryNameInput = shadow.querySelector(".library-name");
  const optionsButton = shadow.querySelector(".options");
  const panel = shadow.querySelector(".panel");
  const autoCheckbox = shadow.querySelector(".auto");
  const verifyLastButton = shadow.querySelector(".verify-last");
  const verifyLastLabel = shadow.querySelector(".verify-last span");
  const toast = shadow.querySelector(".toast");
  const toastCopy = shadow.querySelector(".toast-copy");
  const toastAction = shadow.querySelector(".toast-action");
  const duplicateDialog = shadow.querySelector(".duplicate-dialog");
  const duplicateCount = shadow.querySelector(".duplicate-count");
  const duplicateQuestion = shadow.querySelector(".duplicate-question");
  const existingAnswerLabel = shadow.querySelector(".answer-choice.existing .answer-label");
  const existingAnswerPreview = shadow.querySelector(".answer-choice.existing .answer-preview");
  const newAnswerPreview = shadow.querySelector(".answer-choice.new .answer-preview");
  const cancelDuplicateButton = shadow.querySelector(".duplicate-actions .cancel");
  const keepExistingButton = shadow.querySelector(".duplicate-actions .keep-existing");
  const useNewButton = shadow.querySelector(".duplicate-actions .use-new");
  const serviceDot = shadow.querySelector(".service .dot");
  const serviceText = shadow.querySelector(".service span");
  const serviceSettingsButton = shadow.querySelector(".service-settings");
  const profileSelect = shadow.querySelector(".profile-select");
  const manageProfilesButton = shadow.querySelector(".manage-profiles");
  const modeButtons = [...shadow.querySelectorAll(".mode-button")];
  const scopeButtons = [...shadow.querySelectorAll(".scope-button")];
  const scopeNote = shadow.querySelector(".scope-note");
  const collectionPicker = shadow.querySelector(".collection-picker");
  const collectionSelect = shadow.querySelector(".collection-select");
  const routingNote = shadow.querySelector(".routing-note");
  const collectionDialog = shadow.querySelector(".collection-dialog");
  const collectionDialogTitle = shadow.querySelector("#collection-dialog-title");
  const collectionDialogCopy = shadow.querySelector(".collection-dialog-copy");
  const collectionNameInput = shadow.querySelector(".collection-name-input");
  const createCollectionButton = shadow.querySelector(".create-collection");
  const renameCollectionButton = shadow.querySelector(".rename-collection");
  const cancelCollectionButton = shadow.querySelector(".cancel-collection");
  const saveCollectionButton = shadow.querySelector(".save-collection");
  let toastTimer;
  let dockTimer;
  let statusTimer;
  let duplicateSession = null;
  let collectionEditorMode = "create";

  function dockCanCollapse() {
    return (
      !state.syncing &&
      !state.pinned &&
      panel.hidden &&
      duplicateDialog.hidden &&
      collectionDialog.hidden &&
      toast.hidden &&
      !dock.matches(":hover") &&
      !dock.querySelector(":focus-visible")
    );
  }

  function setDockCollapsed(collapsed) {
    dock.classList.toggle("is-idle", collapsed);
    pinButton.tabIndex = collapsed ? -1 : 0;
    optionsButton.tabIndex = collapsed ? -1 : 0;
    updateSyncButtonTitle();
  }

  function updateSyncButtonTitle() {
    const collapsedLabels = {
      error: "同步失败，点击展开后重试",
      pending: "有新回答等待同步，点击展开",
      success: "同步成功",
      syncing: "正在同步到知识库",
    };
    syncButton.title = dock.classList.contains("is-idle")
      ? collapsedLabels[state.dockStatus] || "展开知识库助手"
      : syncButton.dataset.actionTitle || "同步到知识库";
    syncButton.setAttribute("aria-label", syncButton.title);
  }

  function setDockStatus(status, resetAfter = 0) {
    clearTimeout(statusTimer);
    state.dockStatus = ["pending", "syncing", "success", "error"].includes(status) ? status : "idle";
    dock.dataset.status = state.dockStatus;
    updateSyncButtonTitle();
    if (resetAfter > 0) {
      statusTimer = setTimeout(() => setDockStatus("idle"), resetAfter);
    }
  }

  function revealDock() {
    clearTimeout(dockTimer);
    setDockCollapsed(false);
  }

  function scheduleDockCollapse(delay = 2_800) {
    clearTimeout(dockTimer);
    dockTimer = setTimeout(() => {
      if (dockCanCollapse()) setDockCollapsed(true);
    }, delay);
  }

  function displayLibraryName(value) {
    return String(value || "").trim().slice(0, 24) || "我的知识库";
  }

  function applyLibraryName(value, updateInput = true) {
    state.libraryName = displayLibraryName(value);
    syncLabel.textContent = state.libraryName;
    syncButton.dataset.actionTitle =
      state.syncScope === "last"
        ? `把最后一组完整问答同步到“${state.libraryName}”`
        : `把当前对话中的全部新题同步到“${state.libraryName}”`;
    if (!dock.classList.contains("is-idle")) {
      syncButton.title = syncButton.dataset.actionTitle;
      syncButton.setAttribute("aria-label", syncButton.title);
    }
    if (updateInput) libraryNameInput.value = state.libraryName;
  }

  function activeProfile() {
    return state.profiles.find((profile) => profile.id === state.activeProfileId) || null;
  }

  function renderProfiles(profiles, activeProfileId) {
    state.profiles = Array.isArray(profiles) ? profiles : [];
    state.activeProfileId = activeProfileId || "";
    profileSelect.replaceChildren();
    for (const profile of state.profiles) {
      const option = document.createElement("option");
      option.value = profile.id;
      option.textContent = profile.profileName;
      profileSelect.append(option);
    }
    profileSelect.value = state.activeProfileId;
    const profile = activeProfile();
    if (!profile) return;
    state.fixedCollectionId = profile.fixedCollectionId || "";
    state.fixedCollectionTitle = profile.fixedCollectionTitle || "";
    applyLibraryName(profile.libraryName);
    applyClassificationMode(profile.classificationMode);
  }

  async function loadProfiles() {
    const result = await sendMessage({ type: "chatgpt-sync:profiles" });
    if (result.ok) renderProfiles(result.profiles, result.activeProfileId);
    return result;
  }

  function persistProfilePreferences() {
    if (!state.activeProfileId) return;
    sendMessage({
      type: "chatgpt-sync:update-profile",
      profileId: state.activeProfileId,
      payload: {
        classificationMode: state.classificationMode,
        fixedCollectionId: state.fixedCollectionId,
        fixedCollectionTitle: state.fixedCollectionTitle,
      },
    });
  }

  async function activateSelectedProfile(profileId, showConfirmation = true) {
    profileSelect.disabled = true;
    const result = await sendMessage({ type: "chatgpt-sync:activate-profile", profileId });
    profileSelect.disabled = false;
    if (!result.ok) {
      profileSelect.value = state.activeProfileId;
      showToast(result.error || "切换知识库档案失败", true);
      return;
    }
    renderProfiles(result.profiles, result.activeProfileId);
    state.baseline = null;
    state.failedSignature = "";
    setDockStatus("idle");
    await loadCollections();
    chrome.storage.local.set({ activeProfileId: result.activeProfileId, profileRevision: Date.now() });
    if (showConfirmation) showToast(`已切换到“${result.profile.profileName}”`);
  }

  function showToast(message, error = false, actionUrl = "") {
    revealDock();
    clearTimeout(toastTimer);
    toastCopy.textContent = message;
    toast.classList.toggle("error", error);
    toastAction.hidden = !actionUrl;
    toastAction.removeAttribute("href");
    if (actionUrl) toastAction.href = actionUrl;
    toast.hidden = false;
    toastTimer = setTimeout(() => {
      toast.hidden = true;
      scheduleDockCollapse();
    }, actionUrl ? 7_000 : 3_600);
  }

  async function syncKnowledgeBaseSettings(showConfirmation = false) {
    const result = await sendMessage({
      type: "chatgpt-sync:settings",
      payload: { libraryName: state.libraryName },
    });
    if (result.ok && result.profile) {
      state.profiles = state.profiles.map((profile) =>
        profile.id === result.profile.id ? { ...profile, ...result.profile } : profile,
      );
    }
    if (showConfirmation) {
      showToast(
        result.ok ? `整个网站已改为“${state.libraryName}”` : result.error || "知识库名称更新失败",
        !result.ok,
      );
    }
    return result;
  }

  async function checkHealth() {
    serviceDot.className = "dot";
    serviceText.textContent = "正在检查本地服务…";
    const result = await sendMessage({ type: "chatgpt-sync:health" });
    serviceDot.className = result.ok ? "dot online" : "dot offline";
    if (result.ok) {
      const model = result.classifier?.model?.split("/").at(-1);
      serviceText.textContent = result.classifier?.enabled ? `智能分类已连接 · ${model}` : "本地同步已连接 · 智能分类未启用";
    } else {
      serviceText.textContent = "服务未启动，请运行 pnpm dev:sync";
    }
  }

  function applyClassificationMode(mode, persist = false) {
    state.classificationMode = mode === "fixed" ? "fixed" : "llm";
    for (const button of modeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.mode === state.classificationMode));
    }
    collectionPicker.hidden = state.classificationMode !== "fixed";
    renameCollectionButton.hidden = state.classificationMode !== "fixed";
    if (state.classificationMode === "fixed") {
      syncMeta.textContent = state.fixedCollectionTitle || "固定分类";
      routingNote.textContent = "内容仍会经过收录筛选，但归档位置固定为所选分类。";
    } else {
      syncMeta.textContent = "智能分类";
      routingNote.textContent = "LLM 会查看现有分类并自主选择，必要时创建新分类。";
    }
    if (persist) {
      chrome.storage.local.set({
        classificationMode: state.classificationMode,
        fixedCollectionId: state.fixedCollectionId,
        fixedCollectionTitle: state.fixedCollectionTitle,
      });
      persistProfilePreferences();
    }
  }

  function applySyncScope(scope, persist = false) {
    state.syncScope = scope === "conversation" ? "conversation" : "last";
    for (const button of scopeButtons) {
      button.setAttribute("aria-pressed", String(button.dataset.scope === state.syncScope));
    }
    scopeNote.textContent =
      state.syncScope === "last"
        ? "仅发送最近一组完整问答，适合较长的对话。"
        : "扫描当前对话，并依靠题目 ID 与内容去重，只补充尚未保存的题目。";
    applyLibraryName(state.libraryName);
    if (persist) chrome.storage.local.set({ syncScope: state.syncScope });
  }

  function renderCollections(collections) {
    state.collections = Array.isArray(collections) ? collections : [];
    collectionSelect.replaceChildren();
    if (!state.collections.length) {
      const option = document.createElement("option");
      option.textContent = "还没有可选分类";
      option.value = "";
      collectionSelect.append(option);
      return;
    }
    for (const collection of state.collections) {
      const option = document.createElement("option");
      option.value = collection.collectionId;
      option.textContent = `${collection.collectionTitle} · ${collection.questionCount} 题`;
      collectionSelect.append(option);
    }
    let selected = state.collections.find((collection) => collection.collectionId === state.fixedCollectionId);
    if (!selected && state.fixedCollectionTitle) {
      selected = state.collections.find((collection) => collection.collectionTitle === state.fixedCollectionTitle);
    }
    selected ||= state.collections[0];
    state.fixedCollectionId = selected.collectionId;
    state.fixedCollectionTitle = selected.collectionTitle;
    chrome.storage.local.set({
      fixedCollectionId: state.fixedCollectionId,
      fixedCollectionTitle: state.fixedCollectionTitle,
    });
    collectionSelect.value = state.fixedCollectionId;
    applyClassificationMode(state.classificationMode);
  }

  async function loadCollections() {
    const result = await sendMessage({ type: "chatgpt-sync:collections" });
    if (result.ok) renderCollections(result.collections);
    return result;
  }

  function closeCollectionEditor() {
    collectionDialog.hidden = true;
    saveCollectionButton.disabled = false;
    scheduleDockCollapse();
  }

  function openCollectionEditor(mode) {
    const selected = state.collections.find((collection) => collection.collectionId === state.fixedCollectionId);
    if (mode === "rename" && !selected) {
      showToast("请先选择一个分类", true);
      return;
    }
    collectionEditorMode = mode;
    collectionDialogTitle.textContent = mode === "rename" ? "重命名分类" : "新建分类";
    collectionDialogCopy.textContent =
      mode === "rename"
        ? "只修改显示名称，已有文章地址不会变化。"
        : "创建后会自动设为后续问题的固定分类。";
    saveCollectionButton.textContent = mode === "rename" ? "保存名称" : "创建分类";
    collectionNameInput.value = mode === "rename" ? selected.collectionTitle : "";
    panel.hidden = true;
    optionsButton.setAttribute("aria-expanded", "false");
    revealDock();
    collectionDialog.hidden = false;
    collectionNameInput.focus();
    collectionNameInput.select();
  }

  async function saveCollectionEditor() {
    if (saveCollectionButton.disabled) return;
    const collectionTitle = collectionNameInput.value.trim();
    if (!collectionTitle) {
      showToast("分类名称不能为空", true);
      collectionNameInput.focus();
      return;
    }
    saveCollectionButton.disabled = true;
    const message =
      collectionEditorMode === "rename"
        ? {
            type: "chatgpt-sync:rename-collection",
            collectionId: state.fixedCollectionId,
            payload: { collectionTitle },
          }
        : {
            type: "chatgpt-sync:create-collection",
            payload: { collectionTitle },
          };
    const result = await sendMessage(message);
    if (!result.ok) {
      saveCollectionButton.disabled = false;
      showToast(result.error || "分类保存失败", true);
      return;
    }
    state.fixedCollectionId = result.collection.collectionId;
    state.fixedCollectionTitle = result.collection.collectionTitle;
    renderCollections(result.collections);
    applyClassificationMode("fixed", true);
    closeCollectionEditor();
    showToast(
      collectionEditorMode === "rename"
        ? `分类已改为“${state.fixedCollectionTitle}”`
        : `已创建并选中“${state.fixedCollectionTitle}”`,
    );
  }

  function renderDuplicateConflict() {
    const conflict = duplicateSession.conflicts[duplicateSession.index];
    duplicateCount.textContent = `${duplicateSession.index + 1} / ${duplicateSession.conflicts.length}`;
    duplicateQuestion.textContent =
      conflict.matchType === "semantic" && conflict.existingQuestion
        ? `本次：${conflict.question}\n已有：${conflict.existingQuestion}`
        : conflict.question;
    existingAnswerLabel.textContent = conflict.existingCollection
      ? `知识库现有答案 · ${conflict.existingCollection}`
      : "知识库现有答案";
    existingAnswerPreview.textContent = conflict.existingAnswer || "（现有答案为空）";
    newAnswerPreview.textContent = conflict.newAnswer || "（本次答案为空）";
    duplicateDialog.hidden = false;
    useNewButton.focus();
  }

  function chooseDuplicateAnswers(conflicts) {
    panel.hidden = true;
    optionsButton.setAttribute("aria-expanded", "false");
    revealDock();
    return new Promise((resolve) => {
      duplicateSession = { conflicts, index: 0, resolutions: {}, resolve };
      renderDuplicateConflict();
    });
  }

  function finishDuplicateChoice(choice) {
    if (!duplicateSession) return;
    if (choice === "cancel") {
      const resolve = duplicateSession.resolve;
      duplicateSession = null;
      duplicateDialog.hidden = true;
      resolve(null);
      return;
    }

    const conflict = duplicateSession.conflicts[duplicateSession.index];
    duplicateSession.resolutions[conflict.conflictId] = choice;
    duplicateSession.index += 1;
    if (duplicateSession.index < duplicateSession.conflicts.length) {
      renderDuplicateConflict();
      return;
    }

    const { resolve, resolutions } = duplicateSession;
    duplicateSession = null;
    duplicateDialog.hidden = true;
    resolve(resolutions);
  }

  cancelDuplicateButton.addEventListener("click", () => finishDuplicateChoice("cancel"));
  keepExistingButton.addEventListener("click", () => finishDuplicateChoice("keep_existing"));
  useNewButton.addEventListener("click", () => finishDuplicateChoice("use_new"));

  async function syncConversation(automatic = false) {
    if (state.syncing) return;
    if (isGenerating()) {
      if (!automatic) showToast("回答还在生成，请完成后再同步", true);
      return;
    }
    const extracted = extractConversation();
    if (!extracted.payload.messages.length) {
      if (!automatic) showToast("还没有找到可同步的问答", true);
      return;
    }
    if (state.syncScope === "last" && extracted.payload.messages.at(-1)?.role !== "assistant") {
      if (!automatic) showToast("最后一道问题还没有完整回答", true);
      return;
    }
    if (extracted.payload.messages.at(-1)?.role !== "assistant" && automatic) return;

    state.syncing = true;
    state.failedSignature = "";
    setDockStatus("syncing");
    syncButton.disabled = true;
    syncLabel.textContent = automatic ? "自动整理中…" : "正在整理…";
    let result = await sendMessage({ type: "chatgpt-sync:save", payload: extracted.payload });
    if (result.ok && result.requiresResolution && result.conflicts?.length) {
      const duplicateResolutions = await chooseDuplicateAnswers(result.conflicts);
      if (duplicateResolutions) {
        result = await sendMessage({
          type: "chatgpt-sync:save",
          payload: { ...extracted.payload, duplicateResolutions },
        });
      } else {
        result = { ok: false, cancelled: true };
      }
    }
    state.syncing = false;
    syncButton.disabled = false;
    syncLabel.textContent = state.libraryName;

    if (result.ok) {
      state.baseline = extracted.signature;
      state.failedSignature = "";
      setDockStatus("success", 1_800);
      const skipped = result.skippedCount ? `，忽略 ${result.skippedCount} 条提示词/非复习内容` : "";
      const fallback = result.classificationWarnings?.length ? "，分类接口异常时已回退本地规则" : "";
      showToast(
        state.syncScope === "last"
          ? `最后一题已核对并同步到“${state.libraryName}”${skipped}${fallback}`
          : `${result.questionCount} 个问题已${result.created ? "整理" : "更新"}到“${state.libraryName}”${skipped}${fallback}`,
        false,
        result.pageUrl,
      );
    } else if (result.cancelled) {
      setDockStatus("pending");
      showToast("已取消，本次没有修改知识库");
    } else if (!automatic || result.error) {
      state.failedSignature = extracted.signature;
      setDockStatus("error");
      showToast(result.error || "同步失败", true);
    }
  }

  async function verifyLastQuestionStorage() {
    if (verifyLastButton.disabled) return;
    if (isGenerating()) {
      showToast("最后一道回答还在生成，完成后再检查", true);
      return;
    }
    const extracted = extractConversation();
    if (!extracted.payload.messages.length) {
      showToast("当前页面还没有可检查的问答", true);
      return;
    }
    if (extracted.payload.messages.at(-1)?.role !== "assistant") {
      showToast("最后一道问题还没有完整回答", true);
      return;
    }

    verifyLastButton.disabled = true;
    verifyLastLabel.textContent = "检查中";
    const result = await sendMessage({ type: "chatgpt-sync:verify-last", payload: extracted.payload });
    verifyLastButton.disabled = false;
    verifyLastLabel.textContent = "再次检查";

    if (!result.ok) {
      showToast(result.error || "检查失败，请确认本地服务已启动", true);
      return;
    }
    if (result.status === "stored") {
      showToast(`已确认：最后一题正常存入“${result.collectionTitle}”`, false, result.pageUrl);
      return;
    }
    if (result.status === "stored_existing_answer") {
      showToast(`已收录：同题保留了“${result.collectionTitle}”中的原答案`, false, result.pageUrl);
      return;
    }
    if (result.status === "skipped") {
      showToast(`未存储是正常的：${result.reason}`);
      return;
    }
    if (result.status === "outdated") {
      showToast("已找到题目，但答案不是当前最新版本，请重新同步", true, result.pageUrl);
      return;
    }
    showToast(result.reason || "未找到最后一题，请点击下方主按钮重新同步", true);
  }

  syncButton.addEventListener("click", () => {
    if (dock.classList.contains("is-idle")) {
      revealDock();
      scheduleDockCollapse(4_000);
      return;
    }
    syncConversation(false);
  });
  pinButton.addEventListener("click", () => {
    state.pinned = !state.pinned;
    pinButton.setAttribute("aria-pressed", String(state.pinned));
    pinButton.title = state.pinned ? "取消固定展开" : "固定展开";
    pinButton.setAttribute("aria-label", pinButton.title);
    revealDock();
    if (state.pinned) {
      showToast("已固定展开，本次页面刷新后恢复自动吸附");
    } else {
      showToast("已恢复自动吸附");
    }
  });
  verifyLastButton.addEventListener("click", verifyLastQuestionStorage);
  serviceSettingsButton.addEventListener("click", async () => {
    const result = await sendMessage({ type: "chatgpt-sync:open-options" });
    if (!result.ok) showToast(result.error || "无法打开 API 设置页，请重新加载扩展", true);
  });
  optionsButton.addEventListener("click", () => {
    revealDock();
    panel.hidden = !panel.hidden;
    optionsButton.setAttribute("aria-expanded", String(!panel.hidden));
    if (!panel.hidden) {
      checkHealth();
      loadProfiles().then(() => loadCollections());
    } else {
      scheduleDockCollapse();
    }
  });
  profileSelect.addEventListener("change", () => activateSelectedProfile(profileSelect.value));
  manageProfilesButton.addEventListener("click", async () => {
    const result = await sendMessage({ type: "chatgpt-sync:open-options" });
    if (!result.ok) showToast(result.error || "无法打开档案管理页", true);
  });
  dock.addEventListener("pointerenter", revealDock);
  dock.addEventListener("pointerleave", () => scheduleDockCollapse(1_800));
  dock.addEventListener("focusin", revealDock);
  dock.addEventListener("focusout", () => scheduleDockCollapse(1_800));
  autoCheckbox.addEventListener("change", () => {
    state.autoSync = autoCheckbox.checked;
    chrome.storage.local.set({ autoSync: state.autoSync });
    showToast(state.autoSync ? "已开启自动同步" : "已关闭自动同步");
  });

  libraryNameInput.addEventListener("input", () => applyLibraryName(libraryNameInput.value, false));
  libraryNameInput.addEventListener("change", async () => {
    applyLibraryName(libraryNameInput.value);
    chrome.storage.local.set({ libraryName: state.libraryName });
    await syncKnowledgeBaseSettings(true);
  });
  libraryNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") libraryNameInput.blur();
  });

  for (const button of modeButtons) {
    button.addEventListener("click", async () => {
      if (button.dataset.mode === "fixed" && !state.collections.length) {
        const result = await loadCollections();
        if (!result.ok || !state.collections.length) {
          showToast(result.error || "还没有可选择的分类", true);
          return;
        }
      }
      applyClassificationMode(button.dataset.mode, true);
    });
  }
  for (const button of scopeButtons) {
    button.addEventListener("click", () => {
      applySyncScope(button.dataset.scope, true);
      showToast(
        state.syncScope === "last" ? "后续只同步最后一组完整问答" : "后续同步当前对话中的全部新题",
      );
    });
  }

  collectionSelect.addEventListener("change", () => {
    const selected = state.collections.find((collection) => collection.collectionId === collectionSelect.value);
    state.fixedCollectionId = selected?.collectionId || "";
    state.fixedCollectionTitle = selected?.collectionTitle || "";
    applyClassificationMode("fixed", true);
    showToast(`后续问题将归入“${state.fixedCollectionTitle}”`);
  });
  createCollectionButton.addEventListener("click", () => openCollectionEditor("create"));
  renameCollectionButton.addEventListener("click", () => openCollectionEditor("rename"));
  cancelCollectionButton.addEventListener("click", closeCollectionEditor);
  saveCollectionButton.addEventListener("click", saveCollectionEditor);
  collectionNameInput.addEventListener("keydown", (event) => {
    if (event.key === "Enter") saveCollectionEditor();
    if (event.key === "Escape") closeCollectionEditor();
  });

  chrome.storage.local.get(
    {
      autoSync: false,
      classificationMode: "llm",
      fixedCollectionId: "",
      fixedCollectionTitle: "",
      libraryName: "我的知识库",
      syncScope: "last",
    },
    ({ autoSync, classificationMode, fixedCollectionId, fixedCollectionTitle, libraryName, syncScope }) => {
    state.autoSync = Boolean(autoSync);
    autoCheckbox.checked = state.autoSync;
    state.fixedCollectionId = String(fixedCollectionId || "").trim().slice(0, 100);
    state.fixedCollectionTitle = String(fixedCollectionTitle || "").trim().slice(0, 80);
    applyClassificationMode(classificationMode);
    applySyncScope(syncScope);
    applyLibraryName(libraryName);
    loadProfiles().then(() => loadCollections());
    scheduleDockCollapse();
  });

  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== "local" || !changes.profileRevision) return;
    const previousProfileId = state.activeProfileId;
    loadProfiles().then((result) => {
      if (!result.ok) return;
      if (previousProfileId !== state.activeProfileId) {
        state.baseline = null;
        state.failedSignature = "";
        setDockStatus("idle");
      }
      loadCollections();
    });
  });

  function scanForFinishedAnswer() {
    if (isGenerating()) state.sawGeneration = true;
    clearTimeout(state.scanTimer);
    state.scanTimer = setTimeout(() => {
      const currentId = conversationId();
      const extracted = extractConversation();
      const generating = isGenerating();

      if (currentId !== state.conversationId) {
        state.conversationId = currentId;
        state.baseline = null;
        state.failedSignature = "";
        setDockStatus("idle");
      }
      if (generating) {
        state.sawGeneration = true;
        return;
      }
      if (!extracted.payload.messages.length) return;
      if (state.baseline === null) {
        if (state.autoSync && state.sawGeneration && extracted.payload.messages.at(-1)?.role === "assistant") {
          state.sawGeneration = false;
          syncConversation(true);
          return;
        }
        state.baseline = extracted.signature;
        setDockStatus("idle");
        return;
      }
      if (extracted.signature === state.baseline) {
        if (!state.syncing && state.dockStatus !== "success") setDockStatus("idle");
        return;
      }
      if (extracted.payload.messages.at(-1)?.role === "assistant") {
        if (state.failedSignature !== extracted.signature) setDockStatus("pending");
        if (!state.autoSync || !state.sawGeneration) return;
        state.sawGeneration = false;
        syncConversation(true);
      }
    }, 1_800);
  }

  new MutationObserver(scanForFinishedAnswer).observe(document.body, { childList: true, subtree: true });
  scanForFinishedAnswer();
})();
