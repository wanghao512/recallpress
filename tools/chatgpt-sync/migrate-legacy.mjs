import { readFile, readdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import path from "node:path";

import { parseLegacyMarkdown, saveConversation } from "./sync.mjs";

const projectRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const rootDir = path.join(projectRoot, "src", "interview", "chatgpt");
const entries = await readdir(rootDir, { withFileTypes: true });
let migrated = 0;

for (const entry of entries) {
  if (!entry.isFile() || !entry.name.endsWith(".md") || entry.name === "README.md") continue;
  const filePath = path.join(rootDir, entry.name);
  const redirectPath = `/interview/chatgpt/${entry.name.replace(/\.md$/, ".html")}`;
  const payload = parseLegacyMarkdown(await readFile(filePath, "utf8"), redirectPath);
  if (!payload.conversationId || !payload.messages.length) continue;
  const result = await saveConversation(projectRoot, payload);
  console.log(`已迁移 ${entry.name} -> ${result.relativePath}（${result.questionCount} 个问题）`);
  migrated += 1;
}

console.log(`迁移完成，共处理 ${migrated} 个旧版会话文件。`);
