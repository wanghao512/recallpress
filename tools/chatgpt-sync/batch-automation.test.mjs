import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import vm from "node:vm";

const source = await readFile(
  path.resolve("browser-extension/batch-automation.js"),
  "utf8",
);
const context = vm.createContext({});
vm.runInContext(source, context);
const { buildBatchQueue, parseQuestionList } = context.ChatGPTBatchAutomation;

test("问题清单按行解析、清理序号并去除完全重复项", () => {
  assert.deepEqual(
    [...parseQuestionList("1. 什么是 Attention？\n- 为什么需要缩放？\n\n1. 什么是 Attention？")],
    ["什么是 Attention？", "为什么需要缩放？"],
  );
});

test("批量队列先发送对话规则，再按顺序发送最多 100 道问题", () => {
  const questionList = Array.from({ length: 105 }, (_, index) => `${index + 1}. 问题 ${index + 1}`).join("\n");
  const queue = [...buildBatchQueue("回答时先给简洁结论。", questionList)];

  assert.equal(queue.length, 101);
  assert.deepEqual({ ...queue[0] }, { kind: "instructions", text: "回答时先给简洁结论。" });
  assert.deepEqual({ ...queue[1] }, { index: 0, kind: "question", text: "问题 1" });
  assert.deepEqual({ ...queue.at(-1) }, { index: 99, kind: "question", text: "问题 100" });
});
