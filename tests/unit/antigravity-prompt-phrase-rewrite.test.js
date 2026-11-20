import { describe, expect, it } from "vitest";

import { AntigravityExecutor } from "../../open-sse/executors/antigravity.js";
import { openaiToAntigravityRequest } from "../../open-sse/translator/request/openai-to-gemini.js";

// #5695: a systemInstruction carrying either of these phrases gets a detail-free
// 429 RESOURCE_EXHAUSTED back even while quota is available. Both were reproduced
// against the daily Cloud Code host; see ANTIGRAVITY_PROMPT_REWRITES for the evidence.
const PHRASE = "solve coding tasks. Be concise, practical, and tool-aware.";
const CLAUDE_IDENTITY = "You are Claude Code, Anthropic's official CLI for Claude.";

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

  it("does not match the phrase inside a longer word like 'resolve coding tasks.'", () => {
    const prompt = "You help users resolve coding tasks. Be concise, practical, and tool-aware.";
    const text = systemTextSentToAntigravity("gemini-3.8-flash-high", prompt);
    expect(text).toBe(prompt);
  });
});

describe("Antigravity rewrites the Claude Code identity", () => {
  it("rewrites the full Claude Code persona", () => {
    const text = systemTextSentToAntigravity("gemini-3.8-flash-high", CLAUDE_IDENTITY);
    expect(text).not.toContain("You are Claude Code");
    expect(text).toContain("You are an AI coding assistant");
  });

  it("rewrites the identity in a real Claude Code agent prompt, keeping the rest", () => {
    const prompt = [
      CLAUDE_IDENTITY.replace(".", ", running within the Claude Agent SDK."),
      "",
      "# Tone and style",
      "You should be concise, direct, and to the point.",
      "You are pair programming with a user to " + PHRASE,
    ].join("\n");
    const text = systemTextSentToAntigravity("gemini-3.8-flash-high", prompt);

    expect(text).not.toContain("You are Claude Code");
    expect(text).toContain("You are an AI coding assistant, Anthropic's official CLI for Claude, running within the Claude Agent SDK.");
    expect(text).toContain("# Tone and style");
    expect(text).not.toContain(PHRASE);
  });

  it("matches case-insensitively and without a trailing period", () => {
    expect(systemTextSentToAntigravity("gemini-3.8-flash-high", "you are claude code."))
      .toBe("You are an AI coding assistant.");
    expect(systemTextSentToAntigravity("gemini-3.8-flash-high", "You are Claude Code!"))
      .toBe("You are an AI coding assistant!");
    expect(systemTextSentToAntigravity("gemini-3.8-flash-high", "You are Claude Code"))
      .toBe("You are an AI coding assistant");
  });

  it("leaves other mentions of Claude Code alone", () => {
    for (const prompt of [
      "I am Claude Code.",
      "You are a Claude Code user.",
      "Claude Code",
      "The assistant is Claude Code.",
    ]) {
      expect(systemTextSentToAntigravity("gemini-3.8-flash-high", prompt)).toBe(prompt);
    }
  });
});
