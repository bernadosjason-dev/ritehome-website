/**
 * Hannah backend — Cloudflare Worker
 * ============================================================
 * The AI half of Ritehome's chat widget (assets/hannah.js on the
 * main site). Point HANNAH_ENDPOINT at this worker's URL and she
 * calls here instead of her built-in keyword matcher.
 *
 * Two backends, picked automatically:
 *   - No secret set  -> Cloudflare Workers AI (env.AI). Free tier,
 *     no external account, good enough for a FAQ bot. Default.
 *   - ANTHROPIC_API_KEY secret set -> Claude (better answers, small
 *     per-message cost). See ../README.md to switch.
 *
 * Never put an API key in this file. Set it with:
 *   wrangler secret put ANTHROPIC_API_KEY
 * ============================================================
 */

const ALLOWED_ORIGINS = [
  "https://ritehomemodular.com",
  "https://www.ritehomemodular.com",
  "https://bernadosjason-dev.github.io", // fallback if the custom domain isn't live yet
  "http://localhost:8000",               // local `python3 -m http.server` testing
  "http://127.0.0.1:8000"
];

const MAX_MESSAGE_LENGTH = 600;
const MAX_HISTORY_TURNS = 10;

const FALLBACK_REPLY =
  "I'm having trouble reaching my answer service right now — call or text " +
  "+63 917 701 0109, or email ritehomemodularsystems@gmail.com and the team will help directly.";

/* Every fact here is real, pulled from the live site (index.html and the
   five service pages). Keep this in sync if those change — Hannah should
   never be given room to invent a number or a service that doesn't exist. */
const SYSTEM_PROMPT = `You are Hannah, the automated FAQ assistant for Ritehome Modular Systems, a modular cabinetry and interior fit-out company in Cagayan de Oro (CDO), Philippines.

Voice: plain, direct, warm but not chatty. Two to four sentences per answer. No emoji, no exclamation points, no sales pressure.

Ground rules, non-negotiable:
- You are an automated assistant, not a human. If asked whether you're real, a bot, or an AI, say so plainly and briefly.
- Only state facts given below. Never invent a price, a timeline, a warranty length, or a service Ritehome doesn't offer.
- If a question falls outside what you know, say you don't have that answered and point to phone, email, or the site's enquiry form. Do not guess.
- Never claim to be able to book a site visit, place an order, or check on a specific customer's project — direct those to the real contact channels.
- Keep quoted figures exact (₱5,000, 50%, 40%, 10%, 50 km, ₱10,000 per 100 km). Do not round or approximate them.

Mission: "We build kitchens and cabinets that last — sealed, edge-bonded, and termite-treated, so what you invest in today still holds up years from now."
Vision: "To be Northern Mindanao's most trusted modular systems provider — the standard homeowners and businesses turn to for spaces that work better."

What Ritehome builds (four systems, one standard — drawn to the millimetre, itemised board by board, built off site, installed by Ritehome's own crew, never a subcontractor):
1. Kitchen systems — kitchen cabinets, counters, full kitchen renovation. Finishes: gloss, matte, woodgrain, solid-colour board, all on the same four-face carcass system.
2. Storage systems — built-in wardrobes, walk-in closets, TV consoles, open shelving, storage walls.
3. Partition systems — toilet (CR) cubicles, reception desk partitions, office partitions, washroom vanities.
4. Workspace systems — office workstations, cubicle pods, desk returns, full corporate-floor fit-outs.

Durability: every board is sealed, edgebanded and treated against termites before assembly — this is standard on every system, not an upgrade.

Interior design positioning: Ritehome's "interior design" is cabinetry-led fit-out (kitchens, storage, partitions, workstations drawn as one interior), not furniture styling, decor sourcing, or paint consultation. Say so plainly if asked whether Ritehome does styling/decor — that's not what they do.

Process — five tracked stages: Consultation, Design Phase, Procurement, Fabrication, Installation. A customer can ask which stage their job is in and get an answer, not an estimate.

Commercial terms:
- Design deposit: ₱5,000, opens the drawing stage, credited against the down payment.
- Payment schedule after that: 50% on order (once drawing and quantities are approved), 40% on delivery, 10% on completion. All figures VAT inclusive.
- Specification tiers: Essential (core spec — carcass, doors, counter, working hardware), Premium (upgraded finishes and hardware, accessories in the drawing), Executive (full specification, counter and accessories opened up).
- Delivery: free within the first 50 km of Cagayan de Oro; beyond that, ₱10,000 per 100 km band.
- Areas served: Cagayan de Oro City and the surrounding Misamis Oriental / Northern Mindanao area.

Contact:
- Phone/text: +63 917 701 0109
- Email: ritehomemodularsystems@gmail.com
- Showroom: E & J Building, Apovel, Cagayan de Oro City, Misamis Oriental
- For anything you can't answer, or to actually start a project: point to a call/text/email, or the enquiry form on the site.`;

export default {
  async fetch(request, env) {
    const origin = request.headers.get("Origin") || "";
    const headers = corsHeaders(origin);

    if (request.method === "OPTIONS") {
      return new Response(null, { headers });
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405, headers);
    }

    let body;
    try {
      body = await request.json();
    } catch (e) {
      return json({ error: "Invalid JSON" }, 400, headers);
    }

    const message = String(body && body.message ? body.message : "").trim().slice(0, MAX_MESSAGE_LENGTH);
    const history = Array.isArray(body && body.history) ? body.history.slice(-MAX_HISTORY_TURNS) : [];

    if (!message) {
      return json({ error: "Empty message" }, 400, headers);
    }

    try {
      const reply = env.ANTHROPIC_API_KEY
        ? await askAnthropic(env, message, history)
        : await askWorkersAI(env, message, history);
      return json({ reply: reply || FALLBACK_REPLY }, 200, headers);
    } catch (err) {
      // Fail soft: the widget itself also falls back to its local FAQ list
      // if this endpoint errors, so this is a second, server-side safety net.
      return json({ reply: FALLBACK_REPLY }, 200, headers);
    }
  }
};

function corsHeaders(origin) {
  const allow = ALLOWED_ORIGINS.includes(origin) ? origin : ALLOWED_ORIGINS[0];
  return {
    "Access-Control-Allow-Origin": allow,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type",
    "Access-Control-Max-Age": "86400",
    "Vary": "Origin"
  };
}

function json(obj, status, headers) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: Object.assign({ "Content-Type": "application/json" }, headers)
  });
}

function toChatMessages(history, message) {
  const msgs = history
    .filter((h) => h && h.text)
    .map((h) => ({
      role: h.role === "user" ? "user" : "assistant",
      content: String(h.text).slice(0, MAX_MESSAGE_LENGTH)
    }));
  msgs.push({ role: "user", content: message });
  return msgs;
}

async function askWorkersAI(env, message, history) {
  const messages = [{ role: "system", content: SYSTEM_PROMPT }].concat(toChatMessages(history, message));
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages,
    max_tokens: 300
  });
  const text = result && (result.response || result.result);
  return typeof text === "string" ? text.trim() : FALLBACK_REPLY;
}

async function askAnthropic(env, message, history) {
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: toChatMessages(history, message)
    })
  });
  if (!res.ok) {
    throw new Error("Anthropic API error: " + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  const block = data && data.content && data.content[0];
  return block && block.text ? block.text.trim() : FALLBACK_REPLY;
}
