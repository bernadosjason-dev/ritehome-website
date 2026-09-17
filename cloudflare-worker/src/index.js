/**
 * Hannah backend — Cloudflare Worker
 * ============================================================
 * The AI half of Ritehome's chat widget (assets/hannah.js on the
 * main site). Point HANNAH_ENDPOINT at this worker's URL and she
 * calls here instead of her built-in keyword matcher.
 *
 * Three backends, picked automatically by which secret is set:
 *   1. GEMINI_API_KEY set      -> Google Gemini (the default once set)
 *   2. ANTHROPIC_API_KEY set   -> Claude
 *   3. neither set             -> Cloudflare Workers AI (free, no key)
 *
 * The model is asked to answer AND judge, in one structured response,
 * whether a real person should follow up — a question outside what
 * Hannah knows, a complaint, someone explicitly asking for a human,
 * or (as a hard safety net below) the AI backend itself being down.
 * When that's true, this worker pings a Telegram chat so a real
 * person actually sees it, in addition to whatever Hannah told the
 * visitor. See ../README.md for how to set up Gemini and Telegram.
 *
 * If a visitor gives Hannah a phone number or email, this worker also
 * logs that lead as a row in the same Google Sheet the site's inquiry
 * form writes to (via the Apps Script endpoint in ../google-apps-script/),
 * so a Hannah-captured lead doesn't only ever exist as a Telegram message.
 * Optional -- see README.md for setup.
 *
 * Never put an API key, bot token, or URL in this file. Set them with:
 *   wrangler secret put GEMINI_API_KEY
 *   wrangler secret put TELEGRAM_BOT_TOKEN
 *   wrangler secret put TELEGRAM_CHAT_ID
 *   wrangler secret put APPS_SCRIPT_URL
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
const MAX_IMAGE_BASE64_LENGTH = 6000000; // ~4.5MB decoded — generous over the widget's own client-side compression target
const ALLOWED_IMAGE_MIME = ["image/jpeg", "image/png", "image/webp"];

/* Fed to the model when a photo arrives with no typed question, so a vision
   call still has direction instead of an empty user turn. Never shown to
   the visitor. */
const IMAGE_ONLY_PROMPT =
  "The customer attached a reference photo with no written message. Analyze it " +
  "per the IMAGE-BASED ESTIMATES guidance in your instructions and respond accordingly.";

const FALLBACK_REPLY =
  "I'm having trouble reaching my answer service right now — call or text " +
  "+63 917 701 0109, or email ritehomemodularsystems@gmail.com and the team will help directly.";

/* Phrases that always page a human, whatever the model itself decides —
   belt and suspenders. A missed complaint costs more than an extra ping. */
const HUMAN_TRIGGER_PHRASES = [
  "real person", "a human", "talk to someone", "speak to someone", "live agent",
  "real agent", "manager", "complaint", "refund", "cancel my", "not happy",
  "unhappy", "disappointed", "urgent", "emergency", "reklamo", "sira", "problema"
];

/* Every fact here is real, pulled from the live site (index.html and the
   five service pages). Keep this in sync if those change — Hannah should
   never be given room to invent a number or a service that doesn't exist. */
const FACTS = `You are Hannah, the automated FAQ assistant for Ritehome Modular Systems, a modular cabinetry and interior fit-out company in Cagayan de Oro (CDO), Philippines.

Voice: plain, direct, warm but not chatty. Two to four sentences per answer. No emoji, no exclamation points, no sales pressure.

Ground rules, non-negotiable:
- You are an automated assistant, not a human. If asked whether you're real, a bot, or an AI, say so plainly and briefly.
- Only state facts given below. Never invent a price, a timeline, a warranty length, or a service Ritehome doesn't offer.
- Never claim to be able to book a site visit, place an order, or check on a specific customer's project — direct those to the real contact channels or say a team member will follow up.
- Keep quoted figures exact (₱5,000, 50%, 40%, 10%, 50 km, ₱10,000 per 100 km). Do not round or approximate them.
- The one exception is the PRICING table below — those are ranges by design. Always present them as a ballpark estimate, never as a firm quote, and never state a peso figure that isn't a number or range copied from that table.
- Ritehome quotes per SYSTEM, as one total — never per material, component, or unit. If asked what a single sheet of board, a hinge, a handle, the countertop alone, or a price "per square metre" or "per linear metre" costs, do not give any number, even a range, and do not estimate one from the PRICING table. Say plainly that Ritehome doesn't price by the piece, only the whole system as a package, and offer the total range instead if you have enough to give one.

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

PRICING (ballpark ranges only — VAT-inclusive, derived from RiteHome's real internal quoting tools, refresh these if the business's rates change materially):
- Kitchen systems, by TOTAL effective run length in metres — a NUMBER, not a shape
  name (see KITCHEN LAYOUT SHAPES below for how to turn a shape + wall measurements
  into that one number):
  ESSENTIAL tier — real data points from the business, not a 3-band guess. For a
  length that falls between two points, interpolate linearly between them (e.g.
  a run partway between 3.3m and 4.6m gets a price partway between ₱180,000 and
  ₱230,000, scaled by how far between the two points it sits). For a length below
  2.0m or above 6.0m, use the nearest point's per-metre rate and tell the customer
  the number is approximate outside the confirmed range: 2.0m ₱105,000–₱120,000 ·
  2.5m ₱130,000–₱145,000 · 3.0m ₱155,000–₱170,000 · 3.3m ₱180,000 · 4.6m
  ₱230,000–₱245,000 · 5.0m ₱255,000–₱270,000 · 6.0m ₱305,000–₱320,000.
  PREMIUM and EXECUTIVE tiers — not yet re-derived to real per-length data points
  like Essential above; still banded by size until the business supplies real
  numbers (refresh this the same way Essential was fixed once they do): Small
  (up to ~3.3m) Premium ₱125,000–₱145,000 · Executive ₱155,000–₱180,000. Medium
  (~3.3m to ~4.6m) Premium ₱165,000–₱190,000 · Executive ₱200,000–₱230,000. Large
  (~4.6m and up, to about 6m; beyond that see the note in KITCHEN LAYOUT SHAPES)
  Premium ₱255,000–₱295,000 · Executive ₱295,000–₱345,000. Because Essential is
  now real per-length data and these two tiers are still a coarse band guess, they
  can occasionally land close to or even under a nearby Essential figure — if that
  happens, don't state the Premium/Executive number plainly as more expensive than
  Essential; say the exact Premium/Executive figure for that size needs the team to
  confirm, rather than presenting a possibly-inverted number as fact.
- Storage systems (built-in wardrobe), by opening width: Small (~2.4m) Essential ₱45,000–₱55,000 · Premium ₱60,000–₱70,000 · Executive ₱85,000–₱95,000. Medium (~4.2m) Essential ₱65,000–₱75,000 · Premium ₱80,000–₱95,000 · Executive ₱100,000–₱120,000. Large (~6.0m / walk-in) Essential ₱115,000–₱135,000 · Premium ₱140,000–₱165,000 · Executive ₱165,000–₱190,000.
- Partition systems (CR cubicles): Small (3 cubicles) Essential ₱95,000–₱110,000 · Premium ₱100,000–₱115,000 · Executive ₱110,000–₱125,000. Medium (4 standard + 1 PWD + 2 urinal screens) Essential ₱150,000–₱175,000 · Premium ₱160,000–₱185,000 · Executive ₱175,000–₱205,000. Large (8 standard + 2 PWD + 4 urinal screens) Essential ₱305,000–₱350,000 · Premium ₱320,000–₱370,000 · Executive ₱350,000–₱410,000.
- Workspace systems, by seat count: Small (6 seats) Essential ₱125,000–₱145,000 · Premium ₱170,000–₱195,000 · Executive ₱210,000–₱240,000. Medium (12 seats + meeting table) Essential ₱255,000–₱300,000 · Premium ₱345,000–₱400,000 · Executive ₱405,000–₱470,000. Large (24 seats + conference table + reception) Essential ₱470,000–₱545,000 · Premium ₱615,000–₱710,000 · Executive ₱710,000–₱820,000.
These are the ONLY price figures you may ever state, and only ever as a whole-system
total. For Kitchen Essential, interpolate between the data points as instructed
above. For every other row in this table (Kitchen Premium/Executive, and all of
Storage/Partition/Workspace), if the customer's size falls between two rows, pick
the nearer one and say the estimate is approximate. Never compute, extrapolate, or
invent a number outside this table, and never divide, split, or reverse-engineer
these totals into a per-material, per-unit, per-accessory, or per-square/linear-metre
price — not even a rough one.

KITCHEN LAYOUT SHAPES — how to turn a shape + wall/run measurements into the ONE
total-run NUMBER used above (interpolated against the Essential data points, or
matched to the nearest Small/Medium/Large band for Premium/Executive). A shape name
is not a size: the same shape can land at very different lengths depending on its
real measurements — always compute the number below when you have measurements,
never match a shape name straight to a price.
- Straight (one wall): total run = that wall's length. No deduction.
- Galley/Parallel (two facing runs): total run = sum of both runs — they face each
  other and don't share a corner, so nothing is deducted.
- L-shape (two walls meeting at one corner): total run = WallA + WallB − 1.6m. The
  corner cabinet's footprint belongs to both walls at once, so a plain sum
  over-counts it — subtract 1.6m once for the one shared corner. Example: a 4m wall
  and a 3m wall is NOT a 7m kitchen and is NOT "the 4m row" either — it's
  4 + 3 − 1.6 = 5.4m, which is a Large kitchen.
- U-shape (three walls, two corners): total run = WallA + WallB + WallC − 3.2m
  (1.6m deducted for each of the two shared corners).
- L-shape with an island: apply the L-shape formula to the two walls, then add the
  island's own run length on top — an island doesn't share a corner with a wall, so
  it gets no deduction.
If the customer gives real measurements, ALWAYS run this math rather than guessing
from the shape name, and never take just one of several numbers given and drop the
rest. If the computed total clearly runs bigger than the Large band (comfortably
over ~6m), say so plainly: give the Large range as a floor, not the full answer,
and offer to have the team confirm an exact number for a kitchen that size rather
than understating it.
If the customer gives only ONE measurement and no shape at all (e.g. "2m run" or
"my kitchen is about 3 meters wide"), treat that number as the total run directly —
don't wait for a shape name, and don't substitute a generic anchor size for their
actual number. Always name their own measurement back in the reply (e.g. "for your
2m run...") instead of describing a generic "small kitchen of about 2.7m" — a
number they didn't say.

IMAGE-BASED ESTIMATES: a customer may attach a reference photo instead of, or
alongside, typing measurements. When a photo is present, look for common objects of
known real-world size to judge scale — a standard interior door (~0.8–0.9m wide,
~2.0m tall), a standard base cabinet (~0.6m deep, ~0.85m tall counter height), a
full-size refrigerator (~0.6–0.9m wide), a range/cooktop (~0.6m wide), a floor tile
(commonly ~0.3–0.6m per side) — and use them to judge the visible wall run(s) and
shape (Straight, L-shape, U-shape, Galley/Parallel, Island) the same way you would
from a typed measurement, then run the KITCHEN LAYOUT SHAPES math above. Say plainly,
every time, that this is a rough visual estimate from the photo, not a measured
figure, and that a firm number needs an on-site measurement or the itemised drawing.
If the photo doesn't show a kitchen or room clearly enough to judge scale at all (too
close, too dark, no recognisable reference object, or it isn't a room/kitchen photo
at all), say so honestly and ask for a wider shot or a typed measurement instead of
guessing. Every other pricing rule still applies exactly the same to an image-based
estimate — whole-system totals only, straight from the PRICING table, never a number
invented just because the input was a picture instead of text.

ADD-ON CATEGORIES (for conversation only — never state what one costs; mentioning
them just helps land on the right tier and makes the drawing more useful later):
- Kitchen: soft-close pull-out organisers (cutlery, baskets, pantry pull-outs), a
  corner carousel or magic-corner unit, an upgraded sink and faucet, a built-in range
  hood, under-cabinet LED lighting.
- Storage: pull-out accessories (shoe rack, pants rack, baskets), a pull-down
  wardrobe lift, a built-in mirror, accessory hooks.
- Partition: hardware finish — nylon (budget, private CR), stainless 202 (the
  standard workhorse), or stainless 304 (for public/high-traffic or coastal sites,
  the one that holds up long-term) — plus corner trim and per-cubicle door signage.
- Workspace: desk accessories (monitor arm, CPU holder, keyboard tray, footrest),
  power/data management (desktop power box, cable routing), partition extras
  (sliding panel doors, pin rails), hardware upgrades (designer handles, locks).

Response commitment: when a real person needs to follow up, that's within 2 business
hours. Only state this for the human-follow-up case below — never as a delivery,
fabrication, or installation timeline, which this file does not give a figure for.

Contact:
- Phone/text: +63 917 701 0109
- Email: ritehomemodularsystems@gmail.com
- Showroom: E & J Building, Apovel, Cagayan de Oro City, Misamis Oriental`;

const RESPONSE_FORMAT = `Respond to the customer's latest message. Decide, on every turn, whether a real
person from Ritehome should follow up instead of you — set needs_human true when:
the answer isn't in the facts above and you'd otherwise be guessing or repeating
"I don't know", the customer explicitly asks for a human/agent/manager, they sound
upset, frustrated, or are complaining, or they're asking about their own specific
order/project (which you have no record of). Otherwise set it false.

When a customer describes a project and wants a price, use the PRICING table plainly
and simply — never mention "modules," "linear metres," a table, or that you're doing
a lookup. You need two things before answering: which system (kitchen, storage,
partition, or workspace) and a size. A concrete measurement or count the customer
already gave you — a wall/run length, a wardrobe opening width, a cubicle count, a
seat count, in whatever unit they used, OR an attached reference photo (see
IMAGE-BASED ESTIMATES above) — ALWAYS takes priority over asking anything about size: use it immediately to place them in a band (via KITCHEN LAYOUT SHAPES
for Kitchen, or straight against the row for the other systems) and name their own
number back in the reply ("for your 2m run..."), rather than reciting a generic
anchor size or asking a size question they've effectively already answered. Only
when size is genuinely missing do you ask ONE short, plain-language question to fill
that gap — don't interrogate them with a checklist — and offer it as chips (system
options, or Small/Medium/Large for size) so they can tap instead of typing. For
Kitchen specifically, when you do need to ask, offering the real layout shapes as
chips (e.g. ["Straight","L-shape","U-shape","Island"]) reads more natural than an
abstract size, since most people know their kitchen's shape before they know how to
size it — but a shape name is only a fallback for when no measurement exists yet,
never a reason to ignore one that does. If they give a shape together with real wall
measurements, always run the KITCHEN LAYOUT SHAPES math to get the true total run
rather than matching the shape's typical band by name, and never take just one
number out of several given and drop the rest.
Once you have system and size: if they've also
said a tier (Essential, Premium, or Executive), give that row's range as a friendly
ballpark ("roughly ₱X–₱Y for that size and spec"). If they haven't said a tier,
give the Essential range as a starting point and mention Premium and Executive cost
more for upgraded finishes and hardware. Either way, add in the same breath that the
exact number comes from the itemised drawing once the ₱5,000 design deposit is paid.
Never guess a system or size silently, and never state a figure outside the table.

After giving that first ballpark, ask ONE natural follow-up about add-ons or
specifications from the ADD-ON CATEGORIES list for their system — offered as chips
(2-3 relevant categories plus something like "No extras for now") — to help land on
the right tier, e.g. "would you want anything like a corner carousel or a built-in
range hood, or keep it simple?" Use what they want as a signal, not a calculation:
several add-ons or upgraded hardware/finish nudges the Essential estimate toward
Premium or Executive; "just the basics" confirms Essential. Never state what a
specific add-on costs, and never treat this as a required gate — if they already
just want the number and move on, don't force the question.

If instead they ask for a per-material, per-unit, per-accessory, or per-metre price
(board, hinge, handle, countertop, a specific add-on, "per square meter," "per linear
meter," or similar), give no number at all — explain Ritehome only quotes the whole
system as one total, and offer that total range if you have enough to give one. This
holds even if they insist, rephrase it as "just curious," or ask you to do the
division yourself.

When needs_human is true, still write a normal, helpful "reply" to the customer —
acknowledge you're flagging it for the team, state the 2-business-hour response
commitment plainly, and give the phone number and email as a faster option if they
don't want to wait. If nothing in this conversation yet includes a phone number or
email FROM the customer, also ask for the best one to reach them at, in that same
reply — the team can only call within 2 business hours if they actually have a
number. Don't ask again once one has already been given.

Separately from needs_human, check the customer's LATEST message for a phone number
or email they gave you. If it has one, copy it verbatim into "contact_info"; if not,
"contact_info" is an empty string. Do this on every turn, not only when needs_human
is true — they may answer the "what's the best number" question on a later message
after being asked.

Whenever your reply asks the customer to pick from a small, known set of options —
which system, which size, which spec tier, or a yes/no confirmation — also return
"chips": a list of 2 to 4 short button labels (2-4 words, no punctuation at the end)
they can tap instead of typing. Use the exact words you'd want back if they typed
it, e.g. ["Kitchen","Storage","Partition","Workspace"] or ["Small","Medium","Large"]
or ["Straight","L-shape","U-shape","Island"] or ["Essential","Premium","Executive"].
A tapped chip arrives back as their next
message, unchanged, so never rely on chips to carry information the plain reply
text doesn't already make clear. Leave chips as an empty array when the question is
open-ended (a measurement, a name, an address) or when you're not asking anything.

Output ONLY a JSON object, no other text, in exactly this shape:
{"reply": "<your answer to the customer>", "needs_human": true or false, "reason": "<internal note, under 8 words, empty string if needs_human is false — never a full sentence>", "chips": ["<short option>", "..."] or [], "contact_info": "<phone or email the customer just gave, empty string if none>"}`;

const SYSTEM_PROMPT = FACTS + "\n\n" + RESPONSE_FORMAT;

export default {
  async fetch(request, env, ctx) {
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
    const page = String(body && body.page ? body.page : "").slice(0, 300);
    const alreadyEscalated = !!(body && body.already_escalated);
    const alreadyContacted = !!(body && body.already_contacted);
    const { image, error: imageError } = extractImage(body);

    if (!message && !image) {
      return json({ error: "Empty message" }, 400, headers);
    }
    if (imageError) {
      // Cheap to reject before ever calling an AI backend -- a bad upload
      // shouldn't cost a vision-model call.
      return json({ reply: imageError, needs_human: false, chips: [], contact_captured: false }, 200, headers);
    }

    let reply = FALLBACK_REPLY;
    let needsHuman = false;
    let reason = "";
    let chips = [];
    let contactInfo = "";
    let backendFailed = false;

    try {
      const raw = env.GEMINI_API_KEY
        ? await askGemini(env, message, history, image)
        : env.ANTHROPIC_API_KEY
        ? await askAnthropic(env, message, history, image)
        : await askWorkersAI(env, message, history, image);
      const parsed = parseModelJSON(raw);
      reply = parsed.reply || FALLBACK_REPLY;
      needsHuman = !!parsed.needs_human;
      reason = parsed.reason || "";
      chips = sanitizeChips(parsed.chips);
      contactInfo = sanitizeContactInfo(parsed.contact_info);
    } catch (err) {
      // Fail soft to the visitor (the widget itself also has its own local
      // fallback if this endpoint errors outright) — but the AI being down
      // is exactly the kind of thing a real person should know about.
      backendFailed = true;
      needsHuman = true;
      reason = "AI backend error: " + (err && err.message ? err.message : String(err));
    }

    if (!needsHuman && matchesHumanTrigger(message)) {
      needsHuman = true;
      reason = reason || "Message matched a human-escalation phrase";
    }

    // Page Telegram once per visitor session, not once per message. hannah.js
    // tracks whether a prior message in this same chat already escalated and
    // sends that back as already_escalated -- she still answers every message
    // normally either way, this only throttles the notification itself.
    if (needsHuman && !alreadyEscalated && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      ctx.waitUntil(
        notifyTelegram(env, { message, reply, reason, page, backendFailed }).catch(() => {})
      );
    }

    // A second, independent ping: the customer may only give a callback number
    // after the main escalation already fired (and already throttled itself),
    // so this needs its own once-per-session throttle from the client rather
    // than reusing alreadyEscalated -- otherwise a number given after an
    // escalation would never reach anyone.
    if (contactInfo && !alreadyContacted && env.TELEGRAM_BOT_TOKEN && env.TELEGRAM_CHAT_ID) {
      ctx.waitUntil(
        notifyTelegramContact(env, { contactInfo, message, page }).catch(() => {})
      );
    }

    // Same throttle, but into the same Sheet the inquiry form writes to --
    // otherwise a lead Hannah captures only ever exists as a Telegram
    // message that scrolls away, instead of a row someone can follow up
    // from. Optional: no-ops if APPS_SCRIPT_URL isn't set, same as the
    // Telegram secrets above.
    if (contactInfo && !alreadyContacted && env.APPS_SCRIPT_URL) {
      ctx.waitUntil(
        logLeadToSheet(env, { contactInfo, message, reply, page }).catch(() => {})
      );
    }

    return json({ reply, needs_human: needsHuman, chips, contact_captured: !!contactInfo }, 200, headers);
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

function matchesHumanTrigger(message) {
  const m = message.toLowerCase();
  return HUMAN_TRIGGER_PHRASES.some((p) => m.indexOf(p) !== -1);
}

const MAX_CHIPS = 4;
const MAX_CHIP_LENGTH = 30;

/* The model chose these labels, so treat them like any other untrusted
   input before they reach the visitor's browser as clickable buttons —
   plain strings only, capped in count and length. */
function sanitizeChips(chips) {
  if (!Array.isArray(chips)) return [];
  return chips
    .filter((c) => typeof c === "string" && c.trim())
    .map((c) => c.trim().slice(0, MAX_CHIP_LENGTH))
    .slice(0, MAX_CHIPS);
}

/* The widget always compresses to a JPEG under a few hundred KB client-side,
   so anything hitting these limits is either a bypass of the widget or a
   mistake -- reject cheaply, before any AI backend call, either way. */
function extractImage(body) {
  const raw = body && body.image;
  if (!raw || typeof raw.data !== "string" || !raw.data) return { image: null, error: null };
  const mime = ALLOWED_IMAGE_MIME.includes(raw.mime) ? raw.mime : null;
  if (!mime) {
    return { image: null, error: "That image type isn't supported — please attach a JPEG, PNG, or WEBP photo." };
  }
  if (raw.data.length > MAX_IMAGE_BASE64_LENGTH) {
    return { image: null, error: "That photo's too large — please attach a smaller one." };
  }
  return { image: { mime, data: raw.data }, error: null };
}

const MAX_CONTACT_LENGTH = 60;

/* Only ever forwarded as a Telegram message, but still don't trust it
   blindly -- cap its length, and require something that at least looks
   like a phone number or email so the model can't turn this into a
   noisy no-op channel by copying arbitrary text into it. */
function sanitizeContactInfo(contactInfo) {
  if (typeof contactInfo !== "string") return "";
  const trimmed = contactInfo.trim().slice(0, MAX_CONTACT_LENGTH);
  return /[\d@]/.test(trimmed) ? trimmed : "";
}

/* Models occasionally wrap JSON in prose or a code fence despite
   instructions — parse defensively rather than trust it verbatim. */
function parseModelJSON(text) {
  if (typeof text !== "string") return { reply: FALLBACK_REPLY, needs_human: false, reason: "" };
  var candidate = text.trim();
  try {
    return JSON.parse(candidate);
  } catch (e) {
    var match = candidate.match(/\{[\s\S]*\}/);
    if (match) {
      try {
        return JSON.parse(match[0]);
      } catch (e2) { /* fall through */ }
    }
  }
  // No complete JSON object -- usually a response that got cut off
  // mid-"reason" or mid-"chips" (a long reply + reason can exceed the
  // output token budget). Try to salvage just the "reply" field's text
  // rather than ever showing raw JSON syntax to the visitor.
  var replyMatch = candidate.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (replyMatch) {
    try {
      return { reply: JSON.parse('"' + replyMatch[1] + '"'), needs_human: false, reason: "" };
    } catch (e3) { /* fall through */ }
  }
  // Cut off so early even the closing quote on "reply" never arrived --
  // salvage whatever text came after it anyway, best-effort, since it's
  // still real customer-facing text and better than nothing or raw JSON.
  var openReplyMatch = candidate.match(/"reply"\s*:\s*"((?:[^"\\]|\\.)*)$/);
  if (openReplyMatch && openReplyMatch[1].trim()) {
    try {
      return { reply: JSON.parse('"' + openReplyMatch[1] + '"'), needs_human: false, reason: "" };
    } catch (e4) {
      return { reply: openReplyMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, "\\"), needs_human: false, reason: "" };
    }
  }
  // Even the "reply" field is unrecoverable. If this still looks like
  // broken JSON rather than a model that just ignored the "JSON only"
  // instruction and wrote plain prose, showing it verbatim would read
  // as a visible bug -- fail to the honest fallback and flag a human
  // instead of guessing.
  if (/^\s*\{[\s\S]*"needs_human"/.test(candidate)) {
    return { reply: FALLBACK_REPLY, needs_human: true, reason: "Model returned malformed/truncated JSON" };
  }
  return { reply: candidate, needs_human: false, reason: "" };
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

/* ---------------- Gemini (Google AI Studio) ---------------- */
/* Google renames and retires model IDs, and "Pro"-tier models often carry
   zero free quota unless the underlying Cloud project has billing enabled
   (a different thing from a Gemini app subscription). Rather than hardcode
   one model and need a redeploy every time Google changes something, try
   a short list and use whichever one actually works for this account --
   cheap/high-quota Flash models first, the configured/Pro model last since
   it may need billing this account doesn't have. */
function geminiModelCandidates(env) {
  const candidates = ["gemini-3.5-flash-lite", "gemini-3.6-flash", "gemini-3.1-flash"];
  if (env.GEMINI_MODEL) candidates.unshift(env.GEMINI_MODEL); // explicit choice tried first
  candidates.push("gemini-3.1-pro-preview"); // last resort; needs billing for free-tier accounts
  return [...new Set(candidates)];
}

function isModelUnavailableError(err) {
  return /\b(404|429)\b/.test(String(err && err.message));
}

async function askGemini(env, message, history, image) {
  const candidates = geminiModelCandidates(env);
  let lastErr;
  for (const model of candidates) {
    try {
      return await callGeminiModel(env, model, message, history, image);
    } catch (err) {
      lastErr = err;
      // A wrong/retired model name or an exhausted quota for this model —
      // worth trying the next candidate. Anything else (bad key, malformed
      // request) means every candidate would fail the same way, so stop.
      if (!isModelUnavailableError(err)) throw err;
    }
  }
  throw lastErr;
}

async function callGeminiModel(env, model, message, history, image) {
  const url =
    "https://generativelanguage.googleapis.com/v1beta/models/" + model +
    ":generateContent?key=" + encodeURIComponent(env.GEMINI_API_KEY);

  const contents = history
    .filter((h) => h && h.text)
    .map((h) => ({
      role: h.role === "user" ? "user" : "model",
      parts: [{ text: String(h.text).slice(0, MAX_MESSAGE_LENGTH) }]
    }));
  const lastParts = [];
  if (image) lastParts.push({ inlineData: { mimeType: image.mime, data: image.data } });
  const textForModel = message || (image ? IMAGE_ONLY_PROMPT : "");
  if (textForModel) lastParts.push({ text: textForModel });
  contents.push({ role: "user", parts: lastParts });

  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      system_instruction: { parts: [{ text: SYSTEM_PROMPT }] },
      contents: contents,
      generationConfig: {
        maxOutputTokens: 700,
        responseMimeType: "application/json",
        responseSchema: {
          type: "OBJECT",
          properties: {
            reply: { type: "STRING" },
            needs_human: { type: "BOOLEAN" },
            reason: { type: "STRING" },
            chips: { type: "ARRAY", items: { type: "STRING" } },
            contact_info: { type: "STRING" }
          },
          required: ["reply", "needs_human"]
        }
      }
    })
  });
  if (!res.ok) {
    throw new Error("Gemini API error (" + model + "): " + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  const part = data && data.candidates && data.candidates[0] &&
    data.candidates[0].content && data.candidates[0].content.parts &&
    data.candidates[0].content.parts[0];
  if (!part || typeof part.text !== "string") {
    throw new Error("Gemini API (" + model + ") returned no text (possibly blocked by safety filters)");
  }
  return part.text;
}

/* ---------------- Claude (Anthropic) ---------------- */
async function askAnthropic(env, message, history, image) {
  const messages = toChatMessages(history, message);
  if (image) {
    const last = messages[messages.length - 1];
    last.content = [
      { type: "image", source: { type: "base64", media_type: image.mime, data: image.data } },
      { type: "text", text: message || IMAGE_ONLY_PROMPT }
    ];
  }
  const res = await fetch("https://api.anthropic.com/v1/messages", {
    method: "POST",
    headers: {
      "x-api-key": env.ANTHROPIC_API_KEY,
      "anthropic-version": "2023-06-01",
      "content-type": "application/json"
    },
    body: JSON.stringify({
      model: env.ANTHROPIC_MODEL || "claude-haiku-4-5-20251001",
      max_tokens: 700,
      system: SYSTEM_PROMPT,
      messages: messages
    })
  });
  if (!res.ok) {
    throw new Error("Anthropic API error: " + res.status + " " + (await res.text()));
  }
  const data = await res.json();
  const block = data && data.content && data.content[0];
  if (!block || typeof block.text !== "string") {
    throw new Error("Anthropic API returned no text");
  }
  return block.text;
}

/* ---------------- Cloudflare Workers AI (free default) ---------------- */
/* This fallback's chat model (llama-3.1-8b-instruct) is text-only. Rather
   than drop image support entirely on the one backend that needs no API
   key, caption the photo with a small vision model first and fold that
   description into the text turn — a strictly best-effort path (this is
   the last-resort free backend, only reached if Gemini and Anthropic are
   both unconfigured or down), so a captioning failure degrades to "no
   photo" rather than failing the whole request. */
async function captionImageWorkersAI(env, image) {
  const binary = atob(image.data);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  const result = await env.AI.run("@cf/llava-hf/llava-1.5-7b-hf", {
    image: Array.from(bytes),
    prompt: "Describe this photo in detail: is it a kitchen or room? Describe visible walls, " +
      "cabinets, appliances, doors, and anything else useful for judging real-world scale.",
    max_tokens: 250
  });
  const text = result && (result.description || result.response);
  if (typeof text !== "string" || !text.trim()) {
    throw new Error("Workers AI vision model returned no caption");
  }
  return text.trim();
}

async function askWorkersAI(env, message, history, image) {
  let effectiveMessage = message;
  if (image) {
    try {
      const caption = await captionImageWorkersAI(env, image);
      effectiveMessage = (message ? message + "\n\n" : "") + "[Attached photo — visible contents: " + caption + "]";
    } catch (e) {
      effectiveMessage = message || "The customer attached a reference photo, but it couldn't be analyzed just now — ask them to describe it or give a measurement instead.";
    }
  }
  const messages = [{ role: "system", content: SYSTEM_PROMPT }].concat(toChatMessages(history, effectiveMessage));
  const result = await env.AI.run("@cf/meta/llama-3.1-8b-instruct", {
    messages,
    max_tokens: 700
  });
  const text = result && (result.response || result.result);
  if (typeof text !== "string") {
    throw new Error("Workers AI returned no text");
  }
  return text;
}

/* ---------------- Telegram notification ---------------- */
async function sendTelegramMessage(env, text) {
  const res = await fetch(
    "https://api.telegram.org/bot" + env.TELEGRAM_BOT_TOKEN + "/sendMessage",
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: env.TELEGRAM_CHAT_ID,
        text: text
      })
    }
  );
  if (!res.ok) {
    throw new Error("Telegram API error: " + res.status + " " + (await res.text()));
  }
}

async function notifyTelegram(env, info) {
  const lines = [
    info.backendFailed ? "🔴 Hannah's AI backend is down" : "🔔 Hannah flagged a conversation for you",
    "",
    "Visitor: " + info.message,
    "Hannah replied: " + info.reply,
    info.reason ? "Why: " + info.reason : null,
    info.page ? "Page: " + info.page : null,
    "Time: " + new Date().toISOString()
  ].filter(Boolean);
  await sendTelegramMessage(env, lines.join("\n"));
}

/* Fires independently of notifyTelegram's own throttle -- a visitor can
   supply a callback number on a later message, after the main escalation
   ping already fired and throttled itself for the session. */
async function notifyTelegramContact(env, info) {
  const lines = [
    "📞 Contact info received",
    "",
    "Contact: " + info.contactInfo,
    "Their message: " + info.message,
    info.page ? "Page: " + info.page : null,
    "Time: " + new Date().toISOString()
  ].filter(Boolean);
  await sendTelegramMessage(env, lines.join("\n"));
}

/* ---------------- Lead logging (Google Sheet via Apps Script) ---------------- */
/* google-apps-script/Code.gs's doPost dedupes a submission onto an existing
   row by matching name OR phone OR email -- an OR, not an AND. A name
   that's identical across every Hannah lead (e.g. a plain "Hannah lead")
   would therefore merge unrelated visitors who happen to share that name
   but not a phone or email. Keying the name off the contact info itself
   keeps different visitors from colliding, while still merging correctly
   if the same visitor gives Hannah the same number twice. Code.gs's merge
   branch has a matching rule that only overwrites this placeholder name
   with a real one, never the other way round -- see HANNAH_LEAD_PREFIX
   there, which must stay the same literal string as this. */
const HANNAH_LEAD_PREFIX = "Hannah lead (";

async function logLeadToSheet(env, info) {
  const isEmail = info.contactInfo.indexOf("@") !== -1;
  const notes = "Via Hannah chat" + (info.page ? " (page: " + info.page + ")" : "") +
    ".\nVisitor: " + info.message + "\nHannah: " + info.reply;
  const body = new URLSearchParams({
    name: HANNAH_LEAD_PREFIX + info.contactInfo + ")",
    phone: isEmail ? "" : info.contactInfo,
    email: isEmail ? info.contactInfo : "",
    line: "Hannah chat",
    location: "",
    notes: notes
  });
  const res = await fetch(env.APPS_SCRIPT_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString()
  });
  if (!res.ok) {
    throw new Error("Apps Script lead log error: " + res.status + " " + (await res.text()));
  }
}
