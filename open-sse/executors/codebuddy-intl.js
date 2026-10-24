import { createHash, randomUUID } from "node:crypto";
import { DefaultExecutor } from "./default.js";
import { parseCodeBuddyError } from "./codebuddyError.js";

// RFC-4122-v5-shaped UUID derived from a key, so one conversation keeps one id.
function stableUuidFrom(key) {
  const h = createHash("sha1").update(key).digest("hex");
  const timeHigh = ((parseInt(h.slice(12, 16), 16) & 0x0fff) | 0x5000).toString(16).padStart(4, "0");
  const clockSeq = ((parseInt(h.slice(16, 20), 16) & 0x3fff) | 0x8000).toString(16).padStart(4, "0");
  return [h.slice(0, 8), h.slice(8, 12), timeHigh, clockSeq, h.slice(20, 32)].join("-");
}

// Conversation key: explicit session id, else the opening user message.
function conversationKey(body) {
  const explicit = [body?.session_id, body?.prompt_cache_key, body?.conversation_id].find((v) => typeof v === "string" && v);
  if (explicit) return explicit;
  const first = Array.isArray(body?.messages) ? body.messages.find((m) => m?.role === "user") : null;
  const text = typeof first?.content === "string"
    ? first.content
    : Array.isArray(first?.content) ? first.content.map((b) => b?.text || "").join("\n") : "";
  return text ? `cbai:${text}` : null;
}

/**
 * CodeBuddyIntlExecutor — talks to https://www.codebuddy.ai/v2/chat/completions
 *
 * Same OpenAI-compatible-but-stream-only gateway behavior as codebuddy-cn:
 * non-stream requests are rejected, and reasoning is surfaced only when the
 * request carries the IDE's OpenAI-style reasoning params. Force stream and
 * mirror reasoning_summary exactly like CodeBuddyExecutor.
 */
export class CodeBuddyIntlExecutor extends DefaultExecutor {
  constructor() {
    super("codebuddy-intl");
  }

  // www.codebuddy.ai rejects chat requests without the X-Conversation-* family
  // the official client sends (HTTP 400 code 11128 "conversation id missing" /
  // "channel verification"). All three headers are required; any two still 400.
  // copilot.tencent.com (codebuddy-cn) is not gated.
  buildHeaders(credentials, stream = true, url, model, body = null) {
    const headers = super.buildHeaders(credentials, stream, url, model, body);
    const key = conversationKey(body);
    const messageId = randomUUID();
    headers["X-Conversation-ID"] = key ? stableUuidFrom(key) : randomUUID();
    headers["X-Conversation-Request-ID"] = randomUUID();
    headers["X-Conversation-Message-ID"] = messageId;
    headers["X-Request-ID"] = messageId;
    return headers;
  }

  transformRequest(model, body, stream, credentials) {
    const transformed = super.transformRequest(model, body, stream, credentials);
    transformed.stream = true;

    const eff = transformed.reasoning_effort;
    if (eff === "none" || eff === "off") {
      delete transformed.reasoning_effort;
    } else if (eff) {
      transformed.reasoning_summary = "auto";
    }

    // CodeBuddy rejects plain OpenAI shape (11101 invalid request): needs a
    // leading system prompt + user content as typed blocks, not a bare string.
    const source = Array.isArray(transformed.messages) ? transformed.messages : [];
    transformed.messages = [{ role: "system", content: "You are CodeBuddy Code." }];
    for (const message of source) {
      if (!message || typeof message !== "object" || ["system", "developer"].includes(message.role)) continue;
      if (message.role === "user" && typeof message.content === "string") {
        transformed.messages.push({ ...message, content: [{ type: "text", text: message.content }] });
      } else {
        transformed.messages.push({ ...message });
      }
    }

    return transformed;
  }
  // Same structured error body as codebuddy-cn ({code, msg, displayMsg, ...}).
  parseError(response, bodyText) {
    return parseCodeBuddyError(response, bodyText) || super.parseError(response, bodyText);
  }
}

export default CodeBuddyIntlExecutor;
