// Regression (PROX-90): CodeBuddy rejects a request that fails its channel
// verification (code 11128, "not sent from official client"). The gateway
// answers with its own structured body — {code, msg, requestId, displayMsg,
// displayTips, actions} — not the OpenAI {"error":{...}} shape, so the base
// parser handed the raw JSON blob back and the caller saw an escaped string:
//   [400]: {"code":11128,"msg":"request illegal",...,"displayTips":{...}}
// The provider code and the user-facing text must reach the caller intact,
// on the original 400, without cooling the account down.
import { describe, expect, it } from "vitest";
import { parseCodeBuddyError } from "../../open-sse/executors/codebuddyError.js";
import { CodeBuddyExecutor } from "../../open-sse/executors/codebuddy-cn.js";
import { CodeBuddyIntlExecutor } from "../../open-sse/executors/codebuddy-intl.js";
import { checkFallbackError } from "../../open-sse/services/accountFallback.js";
import { formatProviderError, buildErrorBody } from "../../open-sse/utils/error.js";

const ILLEGAL_REQUEST_BODY = JSON.stringify({
  code: 11128,
  msg: "request illegal",
  requestId: "a899e88a-d5e1-4aee-8bfd-61c0cf3b33dc",
  displayMsg: { en: "Request blocked. Please send it again", zh: "请求被拦截，请重新发送" },
  displayTips: {
    en: "This call failed channel verification, possibly because not sent from official client. Please resend official client.",
    zh: "这次调用没通过渠道校验，可能不是官方客户端发出的。请用官方版本重新发送。",
  },
  actions: ["EDIT_INPUT", "SUBMIT_FEEDBACK"],
});

describe("parseCodeBuddyError — channel-verification rejection (11128)", () => {
  it("keeps the upstream status and surfaces code + human text, not the raw blob", () => {
    const parsed = parseCodeBuddyError({ status: 400 }, ILLEGAL_REQUEST_BODY);

    expect(parsed.status).toBe(400);
    expect(parsed.message).toBe(
      "[11128] request illegal: Request blocked. Please send it again — " +
      "This call failed channel verification, possibly because not sent from official client. Please resend official client."
    );
    expect(parsed.message).not.toContain("{\"code\":11128");
  });

  it("still maps the frequency-limit error (6004) to 429 with a reset time", () => {
    const body = JSON.stringify({ code: 6004, msg: "超过频率限制, 请于 2026-10-23 09:00:00 UTC+8 后重试" });
    const parsed = parseCodeBuddyError({ status: 200 }, body);

    expect(parsed.status).toBe(429);
    expect(parsed.resetsAtMs).toBe(Date.parse("2026-10-23T09:00:00+08:00"));
  });

  it("returns null for non-CodeBuddy bodies so the base parser takes over", () => {
    expect(parseCodeBuddyError({ status: 500 }, "upstream exploded")).toBeNull();
    expect(parseCodeBuddyError({ status: 400 }, JSON.stringify({ error: { message: "bad" } }))).toBeNull();
  });
});

describe("CodeBuddy executors — 11128 reaches the caller", () => {
  for (const [name, Executor] of [["codebuddy-cn", CodeBuddyExecutor], ["codebuddy-intl", CodeBuddyIntlExecutor]]) {
    it(`${name}: 400 body is readable, stays 400, and does not fall back`, () => {
      const parsed = new Executor().parseError({ status: 400 }, ILLEGAL_REQUEST_BODY);
      expect(parsed.status).toBe(400);

      // What chatCore actually sends back to the client
      const errMsg = formatProviderError(new Error(parsed.message), "codebuddy-cn", "gpt-5", parsed.status);
      expect(errMsg).toBe("[400]: [11128] request illegal: Request blocked. Please send it again — This call failed channel verification, possibly because not sent from official client. Please resend official client.");

      // Backoff for blocked intl connections is covered by codebuddy-block-backoff (#5102)
      expect(checkFallbackError(parsed.status, errMsg).shouldFallback).toBe(false);

      const body = buildErrorBody(parsed.status, errMsg);
      expect(body.error.type).toBe("invalid_request_error");
      expect(body.error.message).toContain("channel verification");
    });
  }
});
