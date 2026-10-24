// PROX-90 / decolua/9router#5024: www.codebuddy.ai answers 400 code 11128 unless
// the request carries the X-Conversation-* family the official client sends.
import { describe, expect, it } from "vitest";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const creds = { apiKey: "k", accessToken: "t" };
const build = (body) => new CodeBuddyIntlExecutor().buildHeaders(creds, true, undefined, "glm-5.2", body);

describe("codebuddy-intl conversation headers", () => {
  it("sends all three X-Conversation-* headers as UUIDs", () => {
    const h = build({ messages: [{ role: "user", content: "hi" }] });
    for (const k of ["X-Conversation-ID", "X-Conversation-Request-ID", "X-Conversation-Message-ID"]) {
      expect(h[k]).toMatch(UUID);
    }
    expect(h["X-Request-ID"]).toBe(h["X-Conversation-Message-ID"]);
  });

  it("keeps the conversation id stable across turns, request/message ids fresh", () => {
    const a = build({ messages: [{ role: "user", content: "hi" }] });
    const b = build({ messages: [{ role: "user", content: "hi" }, { role: "assistant", content: "yo" }] });
    expect(b["X-Conversation-ID"]).toBe(a["X-Conversation-ID"]);
    expect(b["X-Conversation-Request-ID"]).not.toBe(a["X-Conversation-Request-ID"]);
    expect(b["X-Conversation-Message-ID"]).not.toBe(a["X-Conversation-Message-ID"]);
  });

  it("prefers an explicit session id", () => {
    const a = build({ session_id: "s1", messages: [{ role: "user", content: "x" }] });
    const b = build({ session_id: "s1", messages: [{ role: "user", content: "y" }] });
    expect(a["X-Conversation-ID"]).toBe(b["X-Conversation-ID"]);
  });

  it("falls back to a random id without a body", () => {
    expect(build(null)["X-Conversation-ID"]).toMatch(UUID);
  });

  it("leaves codebuddy-cn untouched", () => {
    const h = new CodeBuddyExecutor().buildHeaders(creds, true, undefined, "glm-5.2", { messages: [] });
    expect(h["X-Conversation-ID"]).toBeUndefined();
  });
});
