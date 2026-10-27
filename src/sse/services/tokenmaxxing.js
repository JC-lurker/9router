import { getProviderConnections } from "@/lib/localDb";
import { getUsageForProvider } from "open-sse/services/usage.js";
import { parseModel } from "./model.js";
import { scoreQuotas, orderByScore } from "open-sse/services/tokenmaxxing.js";

const TTL = 60_000; // ponytail: per-process cache; add shared cache if multi-instance
const cache = new Map();

async function connScore(c) {
  const hit = cache.get(c.id);
  if (hit && Date.now() - hit.t < TTL) return hit.s;
  let s = null;
  try {
    const u = await getUsageForProvider(c); // ponytail: no token refresh; expired token -> unknown score
    s = scoreQuotas(Object.entries(u?.quotas || {}).map(([name, q]) => ({ name, ...q })));
  } catch {}
  cache.set(c.id, { t: Date.now(), s });
  return s;
}

// Best account score per provider; model score = its provider's best account.
export async function resolveTokenmaxxingOrder(models, log) {
  const byProvider = {};
  const scores = {};
  for (const m of models) {
    const { provider } = parseModel(m);
    if (!provider) continue;
    byProvider[provider] ??= Promise.all(
      (await getProviderConnections({ provider, isActive: true })).map(connScore)
    ).then((r) => { const k = r.filter((x) => x != null); return k.length ? Math.max(...k) : null; });
    scores[m] = await byProvider[provider];
  }
  log?.info("COMBO", `tokenmaxxing scores: ${JSON.stringify(scores)}`);
  return orderByScore(models, scores);
}

// Connection with the highest known positive score for a provider (cached), else null.
export async function bestConnectionId(provider) {
  let best = null, top = 0;
  for (const c of await getProviderConnections({ provider, isActive: true })) {
    const s = await connScore(c);
    if (s != null && s > top) { top = s; best = c.id; }
  }
  return best;
}
