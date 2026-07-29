import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  activateProfile,
  activeProfile,
  createProfile,
  deleteProfile,
  loadProfiles,
  updateProfile,
  validateProjectRoot,
} from "./profiles.mjs";

async function createCompatibleProject(parent, name, libraryName) {
  const projectRoot = path.join(parent, name);
  await mkdir(path.join(projectRoot, "src", ".vuepress"), { recursive: true });
  await mkdir(path.join(projectRoot, "src", "interview"), { recursive: true });
  await writeFile(
    path.join(projectRoot, "package.json"),
    '{"type":"module","scripts":{"docs:dev":"vuepress-vite dev src"}}\n',
    "utf8",
  );
  await writeFile(path.join(projectRoot, "src", "README.md"), "---\n---\n", "utf8");
  await writeFile(path.join(projectRoot, "src", "interview", "README.md"), "---\n---\n", "utf8");
  await writeFile(
    path.join(projectRoot, "src", ".vuepress", "knowledgeBase.ts"),
    `export default { name: ${JSON.stringify(libraryName)} };\n`,
    "utf8",
  );
  return projectRoot;
}

test("旧项目自动成为默认知识库档案", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatgpt-profiles-default-"));

  try {
    const serviceRoot = await createCompatibleProject(parent, "learning", "学习知识库");
    const state = await loadProfiles(serviceRoot);

    assert.equal(state.activeProfileId, "default");
    assert.equal(state.profiles.length, 1);
    assert.equal(state.profiles[0].profileName, "学习");
    assert.equal(state.profiles[0].libraryName, "学习知识库");
    assert.equal(state.profiles[0].projectRoot, serviceRoot);
    assert.equal(activeProfile(state).id, "default");
    assert.doesNotMatch(
      await readFile(path.join(serviceRoot, ".chatgpt-sync", "profiles.json"), "utf8"),
      /apiKey/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("档案加载时同步项目中的真实知识库名称", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatgpt-profiles-library-name-"));

  try {
    const serviceRoot = await createCompatibleProject(parent, "learning", "旧知识库");
    await loadProfiles(serviceRoot);
    await writeFile(
      path.join(serviceRoot, "src", ".vuepress", "knowledgeBase.ts"),
      'export default { name: "新知识库" };\n',
      "utf8",
    );

    const state = await loadProfiles(serviceRoot);

    assert.equal(state.profiles[0].libraryName, "新知识库");
    assert.equal(state.profiles[0].profileName, "新");
    assert.match(
      await readFile(path.join(serviceRoot, ".chatgpt-sync", "profiles.json"), "utf8"),
      /"libraryName": "新知识库"/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("可以创建、切换、修改和移除知识库档案", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatgpt-profiles-manage-"));

  try {
    const serviceRoot = await createCompatibleProject(parent, "learning", "学习知识库");
    const courseRoot = await createCompatibleProject(parent, "course-notes", "课程笔记");
    const created = await createProfile(serviceRoot, {
      libraryName: "课程笔记",
      profileName: "课程复习",
      projectRoot: courseRoot,
      siteUrl: "http://localhost:8081",
    });
    const profileId = created.profile.id;

    assert.equal(created.profiles.length, 2);
    assert.equal(created.profile.projectRoot, courseRoot);

    const activated = await activateProfile(serviceRoot, profileId);
    assert.equal(activated.activeProfileId, profileId);
    assert.equal(activeProfile(activated).profileName, "课程复习");

    const updated = await updateProfile(serviceRoot, profileId, {
      classificationMode: "fixed",
      fixedCollectionId: "database",
      fixedCollectionTitle: "数据库面试题",
      profileName: "数据库课程",
    });
    assert.equal(updated.profile.classificationMode, "fixed");
    assert.equal(updated.profile.fixedCollectionTitle, "数据库面试题");

    await writeFile(
      path.join(courseRoot, "src", ".vuepress", "knowledgeBase.ts"),
      'export default { name: "课程资料库" };\n',
      "utf8",
    );
    const refreshed = await loadProfiles(serviceRoot);
    const refreshedCourse = refreshed.profiles.find((profile) => profile.id === profileId);
    assert.equal(refreshedCourse.libraryName, "课程资料库");
    assert.equal(refreshedCourse.profileName, "数据库课程");

    const deleted = await deleteProfile(serviceRoot, profileId);
    assert.equal(deleted.profiles.length, 1);
    assert.equal(deleted.activeProfileId, "default");
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});

test("拒绝不兼容目录和重复项目目录", async () => {
  const parent = await mkdtemp(path.join(os.tmpdir(), "chatgpt-profiles-invalid-"));

  try {
    const serviceRoot = await createCompatibleProject(parent, "learning", "学习知识库");
    const invalidRoot = path.join(parent, "plain-folder");
    await mkdir(invalidRoot);

    await assert.rejects(() => validateProjectRoot(invalidRoot), /不是兼容的 VuePress 知识库/);
    await assert.rejects(
      () =>
        createProfile(serviceRoot, {
          libraryName: "重复知识库",
          profileName: "重复档案",
          projectRoot: serviceRoot,
        }),
      /已经存在于档案列表/,
    );
  } finally {
    await rm(parent, { recursive: true, force: true });
  }
});
