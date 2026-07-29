import { readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";

function cleanName(value) {
  return String(value ?? "")
    .replace(/[\r\n\t]/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim()
    .slice(0, 24);
}

async function atomicWrite(filePath, content) {
  const temporaryPath = path.join(path.dirname(filePath), `.${path.basename(filePath)}.${process.pid}.tmp`);
  await writeFile(temporaryPath, content, "utf8");
  await rename(temporaryPath, filePath);
}

function renderConfig(name) {
  return [
    "export default {",
    `  description: ${JSON.stringify(`沉淀 ChatGPT 问答，构建“${name}”`)},`,
    `  name: ${JSON.stringify(name)},`,
    "};",
    "",
  ].join("\n");
}

function updateHomeTitle(content, name) {
  const titleMarker = /(# knowledge-base-title\s*\n)title:\s*[^\n]*/;
  const headingMarker = /(<!-- knowledge-base-heading -->\s*\n)#\s*[^\n]*/;
  if (!titleMarker.test(content) || !headingMarker.test(content)) {
    throw new Error("知识库首页缺少可更新的名称标记");
  }
  const withTitle = content.replace(titleMarker, (_match, prefix) => `${prefix}title: ${JSON.stringify(name)}`);
  return withTitle.replace(headingMarker, (_match, prefix) => `${prefix}# ${name}`);
}

function updateRootHomeTitle(content, name) {
  const titleMarker = /(# knowledge-base-home-title\s*\n)title:\s*[^\n]*/;
  const heroMarker = /(# knowledge-base-hero-text\s*\n)heroText:\s*[^\n]*/;
  if (!titleMarker.test(content) || !heroMarker.test(content)) {
    throw new Error("知识库项目首页缺少可更新的名称标记");
  }
  const withTitle = content.replace(titleMarker, (_match, prefix) => `${prefix}title: ${JSON.stringify(name)}`);
  return withTitle.replace(heroMarker, (_match, prefix) => `${prefix}heroText: ${JSON.stringify(name)}`);
}

export async function updateKnowledgeBaseSettings(projectRoot, input = {}) {
  const name = cleanName(input.libraryName);
  if (!name) throw new Error("知识库名称不能为空");

  const configPath = path.join(projectRoot, "src", ".vuepress", "knowledgeBase.ts");
  const homePath = path.join(projectRoot, "src", "README.md");
  const interviewHomePath = path.join(projectRoot, "src", "interview", "README.md");
  const nextConfig = renderConfig(name);
  const currentConfig = await readFile(configPath, "utf8").catch(() => "");
  const currentHome = await readFile(homePath, "utf8");
  const currentInterviewHome = await readFile(interviewHomePath, "utf8");
  const nextHome = updateRootHomeTitle(currentHome, name);
  const nextInterviewHome = updateHomeTitle(currentInterviewHome, name);

  if (currentConfig !== nextConfig) await atomicWrite(configPath, nextConfig);
  if (currentHome !== nextHome) await atomicWrite(homePath, nextHome);
  if (currentInterviewHome !== nextInterviewHome) await atomicWrite(interviewHomePath, nextInterviewHome);

  return {
    changed: currentConfig !== nextConfig || currentHome !== nextHome || currentInterviewHome !== nextInterviewHome,
    libraryName: name,
  };
}
