import { spawn } from "node:child_process";
import { mkdirSync, readFileSync, unwatchFile, watch, watchFile } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const serviceRoot = path.resolve(fileURLToPath(new URL("../..", import.meta.url)));
const serverPath = fileURLToPath(new URL("./server.mjs", import.meta.url));
const pnpmCommand = process.platform === "win32" ? "pnpm.cmd" : "pnpm";
const profilesFile = path.join(serviceRoot, ".chatgpt-sync", "profiles.json");
const syncChild = spawn(process.execPath, [serverPath], { cwd: serviceRoot, stdio: "inherit" });
let docsProjectRoot = activeProjectRoot();
let docsChild;
let notesWatcher;
let restartTimer;
let restartingDocs = false;

let stopping = false;

function activeProjectRoot() {
  try {
    const state = JSON.parse(readFileSync(profilesFile, "utf8"));
    const profile = state.profiles?.find((item) => item.id === state.activeProfileId);
    return profile?.projectRoot ? path.resolve(profile.projectRoot) : serviceRoot;
  } catch {
    return serviceRoot;
  }
}

function registerChild(child, restartable = false) {
  child.on("error", (error) => {
    console.error(`启动失败: ${error.message}`);
    stop(1);
  });
  child.on("exit", (code, signal) => {
    if (restartable && restartingDocs) return;
    if (!stopping && code !== 0 && signal !== "SIGTERM") stop(code || 1);
  });
}

function startDocs() {
  console.log(`正在预览知识库: ${docsProjectRoot}`);
  docsChild = spawn(pnpmCommand, ["run", "docs:dev"], { cwd: docsProjectRoot, stdio: "inherit" });
  registerChild(docsChild, true);
}

function restartDocs(nextProjectRoot = docsProjectRoot) {
  docsProjectRoot = nextProjectRoot;
  if (stopping || !docsChild || docsChild.killed) return;
  const previous = docsChild;
  restartingDocs = true;
  previous.once("exit", () => {
    restartingDocs = false;
    if (!stopping) startDocs();
  });
  previous.kill("SIGTERM");
}

function watchNotes() {
  notesWatcher?.close();
  const notesDir = path.join(docsProjectRoot, "src", "interview", "chatgpt");
  mkdirSync(notesDir, { recursive: true });
  notesWatcher = watch(notesDir, { recursive: true }, (eventType, filename) => {
    if (eventType !== "rename" || !filename?.endsWith(".md")) return;
    clearTimeout(restartTimer);
    restartTimer = setTimeout(() => restartDocs(), 350);
  });
}

function switchActiveProject() {
  const nextProjectRoot = activeProjectRoot();
  if (nextProjectRoot === docsProjectRoot) return;
  console.log(`知识库已切换: ${nextProjectRoot}`);
  clearTimeout(restartTimer);
  restartDocs(nextProjectRoot);
  watchNotes();
}

registerChild(syncChild);
startDocs();
watchNotes();
watchFile(profilesFile, { interval: 500 }, switchActiveProject);

function stop(exitCode = 0) {
  if (stopping) return;
  stopping = true;
  restartingDocs = false;
  clearTimeout(restartTimer);
  unwatchFile(profilesFile, switchActiveProject);
  notesWatcher?.close();
  for (const child of [syncChild, docsChild]) {
    if (child && !child.killed) child.kill("SIGTERM");
  }
  setTimeout(() => process.exit(exitCode), 200).unref();
}

process.on("SIGINT", () => stop(0));
process.on("SIGTERM", () => stop(0));
