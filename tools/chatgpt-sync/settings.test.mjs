import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { updateKnowledgeBaseSettings } from "./settings.mjs";

test("知识库名称同步更新站点配置与首页", async () => {
  const projectRoot = await mkdtemp(path.join(os.tmpdir(), "chatgpt-sync-settings-test-"));
  const vuepressDir = path.join(projectRoot, "src", ".vuepress");
  const interviewDir = path.join(projectRoot, "src", "interview");
  await mkdir(vuepressDir, { recursive: true });
  await mkdir(interviewDir, { recursive: true });
  await writeFile(
    path.join(projectRoot, "src", "README.md"),
    '---\n# knowledge-base-home-title\ntitle: "旧名称"\n# knowledge-base-hero-text\nheroText: "旧名称"\n---\n',
    "utf8",
  );
  await writeFile(
    path.join(interviewDir, "README.md"),
    '---\n# knowledge-base-title\ntitle: "旧名称"\n---\n\n<!-- knowledge-base-heading -->\n# 旧名称\n',
    "utf8",
  );

  try {
    const first = await updateKnowledgeBaseSettings(projectRoot, { libraryName: "算法学习花园" });
    const second = await updateKnowledgeBaseSettings(projectRoot, { libraryName: "算法学习花园" });
    const config = await readFile(path.join(vuepressDir, "knowledgeBase.ts"), "utf8");
    const rootHome = await readFile(path.join(projectRoot, "src", "README.md"), "utf8");
    const home = await readFile(path.join(interviewDir, "README.md"), "utf8");

    assert.equal(first.changed, true);
    assert.equal(second.changed, false);
    assert.match(config, /name: "算法学习花园"/);
    assert.match(rootHome, /heroText: "算法学习花园"/);
    assert.match(home, /title: "算法学习花园"/);
    assert.match(home, /# 算法学习花园/);
  } finally {
    await rm(projectRoot, { recursive: true, force: true });
  }
});
