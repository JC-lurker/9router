// CodeBuddy gateways (copilot.tencent.com / codebuddy.ai) answer with their own
// structured error body instead of the OpenAI `{"error":{...}}` shape:
//   {"code":11128,"msg":"request illegal","requestId":"...",
//    "displayMsg":{"en":"Request blocked. Please send it again"},
//    "displayTips":{"en":"This call failed channel verification, ..."}}
// The base parseError hands the raw JSON blob back, so the caller ends up with
// an escaped string that buries both the provider code and the user-facing text
// (`[400]: {"code":11128,"msg":...}`). Parse it into a readable message.
export function parseCodeBuddyError(response, bodyText) {
  if (!bodyText) return null;
  let data;
  try {
    data = JSON.parse(bodyText);
  } catch {
    return null;
  }
  const msg = data?.msg || data?.message || data?.error?.message || "";

  if (data?.code === 6004 || /超出频率限制|frequency limit|限额/i.test(msg)) {
    let resetsAtMs = null;
    const match = msg.match(/(\d{4}-\d{2}-\d{2})\s+(\d{2}:\d{2}:\d{2})(?:\s*UTC\+?([0-9:]+))?/i);
    if (match) {
      const dp = match[1];
      const tp = match[2];
      const tz = match[3]
        ? (match[3].includes(":") ? (match[3].startsWith("+") ? match[3] : `+${match[3]}`) : `+${match[3].padStart(2, "0")}:00`)
        : "+08:00";
      const dt = new Date(`${dp}T${tp}${tz}`);
      if (!isNaN(dt.getTime())) resetsAtMs = dt.getTime();
    }
    return {
      status: 429,
      message: msg || "CodeBuddy frequency limit (6004)",
      resetsAtMs,
    };
  }

  // CodeBuddy's own shape only — an OpenAI {"error":{...}} body keeps the base
  // parser (and its caller) untouched.
  if (!data?.code || !msg) return null;
  const extra = [data?.displayMsg?.en, data?.displayTips?.en].filter(Boolean).join(" — ");
  return {
    status: response.status,
    message: `[${data.code}] ${msg}${extra ? `: ${extra}` : ""}`,
  };
}

export default parseCodeBuddyError;
