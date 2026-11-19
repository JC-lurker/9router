import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// #5695: sending this sentence pair in systemInstruction makes Antigravity answer a
// detail-free 429 RESOURCE_EXHAUSTED even with quota available.
const PHRASE = "solve coding tasks. Be concise, practical, and tool-aware.";

function systemTextSentToAntigravity(model, systemContent) {
  const body = openaiToAntigravityRequest(model, {
    messages: [
      { role: "system", content: systemContent },
      { role: "user", content: "hi" },
    ],
  }, true);
  const finalBody = new AntigravityExecutor().transformRequest(model, body, true, {});
  return finalBody.request.systemInstruction.parts.map((p) => p.text).join("\n");
}

describe("Antigravity rewrites the #5695 system prompt phrase", () => {
  it("rewrites the flagged sentence pair sent by an OpenAI-format client", () => {
    const text = systemTextSentToAntigravity(
      "gemini-3.8-flash-high",
      `You are pair programming with a user to ${PHRASE}`
    );
    expect(text).not.toContain(PHRASE);
    expect(text).toContain("work on their coding tasks.");
  });

  it("rewrites the newline-separated variant that is also rejected", () => {
    const text = systemTextSentToAntigravity(
      "gemini-4-argon-high",
      "You are pair programming with a user to solve coding tasks.\nBe concise, practical, and tool-aware."
    );
    expect(text).not.toContain("solve coding tasks.");
    expect(text).toContain("work on their coding tasks.");
  });

  it("rewrites every systemInstruction part, including replayed client prompts", () => {
    const model = "claude-opus-5-5-high";
    const body = openaiToAntigravityRequest(model, {
      messages: [
        { role: "system", content: `Replayed persona: You ${PHRASE}` },
        { role: "user", content: "hi" },
      ],
    }, true);
    body.request.systemInstruction.parts.push({ text: `Second stored prompt: You ${PHRASE}` });
    const finalBody = new AntigravityExecutor().transformRequest(model, body, true, {});

    const parts = finalBody.request.systemInstruction.parts.map((p) => p.text);
    expect(parts).toHaveLength(2);
    for (const part of parts) expect(part).not.toContain(PHRASE);
  });

  it("leaves unrelated system prompts untouched", () => {
    const prompt = "You are a helpful assistant. Be concise, practical, and tool-aware.";
    const text = systemTextSentToAntigravity("gemini-3.8-flash-high", prompt);
    expect(text).toBe(prompt);
  });
});
