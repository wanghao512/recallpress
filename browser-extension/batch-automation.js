(() => {
  const MAX_QUESTIONS = 100;
  const MAX_SYSTEM_PROMPT_LENGTH = 8_000;

  function cleanLine(value) {
    return String(value || "")
      .replace(/^\s*(?:[-*•]\s+|\d{1,3}[.、．)]\s*)/u, "")
      .trim();
  }

  function parseQuestionList(value) {
    const seen = new Set();
    const questions = [];

    for (const line of String(value || "").split(/\n/u)) {
      const question = cleanLine(line);
      if (!question || seen.has(question)) continue;
      seen.add(question);
      questions.push(question);
      if (questions.length >= MAX_QUESTIONS) break;
    }

    return questions;
  }

  function buildBatchQueue(systemPrompt, questionList) {
    const prompt = String(systemPrompt || "").trim().slice(0, MAX_SYSTEM_PROMPT_LENGTH);
    const questions = parseQuestionList(questionList);
    return [
      ...(prompt ? [{ kind: "instructions", text: prompt }] : []),
      ...questions.map((text, index) => ({ index, kind: "question", text })),
    ];
  }

  globalThis.ChatGPTBatchAutomation = {
    MAX_QUESTIONS,
    buildBatchQueue,
    parseQuestionList,
  };
})();
