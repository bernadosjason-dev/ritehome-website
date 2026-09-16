# Hannah's backend (Cloudflare Worker)

This is the optional AI backend for Hannah, the chat widget on
ritehomemodular.com (`assets/hannah.js`). Without it, Hannah still
works — she answers from a built-in FAQ list. This worker upgrades
her to a real language model, using the conversation history she
already keeps in the browser, and pings your **Telegram** whenever a
real person should follow up instead of her.

Deploy time: about 15 minutes, first time (10 for the worker, 5 for
Telegram).

## 1. Prerequisites

- **Node.js** installed (18+). Check with `node -v`.
- A **Cloudflare account** — free, no card required for what's here.
  [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)

## 2. Install Wrangler and log in

```
npm install -g wrangler
wrangler login
```
`login` opens a browser tab to authorize — approve it, come back to the terminal.

## 3. Get a Gemini API key — read this part carefully

Hannah is built to use **your Gemini account** as the primary AI backend.
One thing to get right first:

> **A Gemini API key is not the same thing as a "Gemini Pro" or
> "Google One AI Premium" subscription.** That consumer subscription
> gets you Gemini inside the Gemini app, Gmail, Docs, etc. — it does
> **not** include an API key for a program like this worker to call.
> The API key comes from a separate place, below, and its usage is
> billed separately (with its own free tier).

Get the key:

1. Go to [aistudio.google.com/apikey](https://aistudio.google.com/apikey)
   and sign in with the same Google account as your Gemini subscription.
2. Click **Create API key**. Copy it — you won't see it again in full.
3. If you want the *paid* tier's higher rate limits and are already
   paying for Gemini API usage elsewhere (separate from the consumer
   subscription), make sure billing is enabled on that Google Cloud
   project. The free tier works fine for a FAQ bot's volume either way.

Set it as a secret (never in code, never in git):

```
cd cloudflare-worker
wrangler secret put GEMINI_API_KEY
```
Paste the key when prompted.

The worker doesn't hardcode a single model and hope — Google both
retires model IDs over time and gives "Pro"-tier models zero free
quota unless the underlying Cloud project has billing enabled (a
different thing from a Gemini app subscription; hitting this looks
like a 429 "quota exceeded ... limit: 0" error). So it tries a short
list automatically, in order, and uses whichever one actually works
for your account:

1. `GEMINI_MODEL`, if you've set one — your explicit choice always
   goes first.
2. `gemini-3.5-flash-lite`, `gemini-3.6-flash`, `gemini-3.1-flash` —
   free-tier-friendly fallbacks.
3. `gemini-3.1-pro-preview` — tried last, since it's the one most
   likely to need billing enabled to work at all.

It only moves to the next candidate on a 404 (model retired/renamed)
or 429 (quota exhausted for that model) — any other error (a bad API
key, a malformed request) fails immediately instead of burning
through the whole list pointlessly. If every candidate fails, Hannah
still answers the visitor with her "having trouble reaching my
answer service" line and pages Telegram with the *real* underlying
error from whichever model failed last — that error message is the
fastest way to know what actually broke, without needing to redeploy
just to see a different failure.

To pin a specific model instead of the automatic list (e.g. once
you've enabled billing and specifically want Pro-tier quality):
```
wrangler secret put GEMINI_MODEL
```

## 4. Set up the Telegram notification

Hannah asks the model, on every message, whether a real person should
follow up — an off-script question, a complaint, someone explicitly
asking for a human, or her AI backend simply being down. When that's
true, this worker sends a Telegram message so you actually see it.

**Create a bot:**
1. Open Telegram, search for **@BotFather**, start a chat.
2. Send `/newbot`, follow the two prompts (a display name, then a
   username ending in `bot`).
3. BotFather replies with a token — looks like `123456789:AAExxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`. Copy it.

**Get your chat ID** (so the bot knows where to send it):
1. Search for the bot you just created (by the username you gave it)
   and send it any message, e.g. "hi" — Telegram requires you to
   message a bot first before it can message you.
2. In a browser, visit (replace `<TOKEN>` with your bot's token):
   ```
   https://api.telegram.org/bot<TOKEN>/getUpdates
   ```
3. Find `"chat":{"id":` in the response — the number after it is your
   chat ID (a plain integer, sometimes negative for group chats).

**Set both as secrets:**
```
wrangler secret put TELEGRAM_BOT_TOKEN
wrangler secret put TELEGRAM_CHAT_ID
```

## 5. Deploy

**This now happens automatically.** `.github/workflows/deploy-hannah.yml` runs
`wrangler deploy` on every push to `main` that touches `cloudflare-worker/`,
using a `CLOUDFLARE_API_TOKEN` repo secret (Settings → Secrets and variables
→ Actions, on GitHub). Merge to `main`, done — no local Wrangler login, no
manual step. If that secret is ever missing or revoked, the workflow run
fails visibly under the repo's **Actions** tab rather than silently.

Only run it by hand if you're testing outside of `main`:
```
wrangler deploy
```

Wrangler prints a URL when it finishes:
```
https://ritehome-hannah.<your-subdomain>.workers.dev
```
That's Hannah's brain. Copy it.

## 6. Point Hannah at it

Open `assets/hannah.js` at the repo root, find:
```js
var HANNAH_ENDPOINT = "";
```
Paste the URL from step 5 between the quotes, commit, push. Hannah
now calls the worker — and if it's ever unreachable, she falls back
to her local FAQ list automatically (and, per step 4, that failure
itself pages your Telegram).

## 7. Test it

Direct test:
```
curl -X POST "https://ritehome-hannah.<your-subdomain>.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{"message":"I want to talk to a real person, I have a complaint"}'
```
Should return `{"reply": "...", "needs_human": true}` — and you
should get a Telegram message within a second or two.

Then test for real: open the site, ask Hannah something ordinary
(should answer, no Telegram ping) and something that should escalate
(a complaint, "let me talk to a person") and confirm both behave as
expected.

## How the AI is chosen

The worker checks secrets in this order and uses the first one set:

1. `GEMINI_API_KEY` — Gemini (what step 3 sets up)
2. `ANTHROPIC_API_KEY` — Claude, if you'd rather use that instead
3. Neither set — Cloudflare Workers AI (free, no key, lower quality)

You only need to set one. Gemini is the intended default here.

## Costs and limits

- **Gemini:** free tier is generous for a small business FAQ bot;
  Google's pricing page has current numbers if you exceed it.
- **The Worker itself:** Cloudflare's free plan includes 100,000
  requests/day — effectively unlimited for this.
- **Telegram:** free, no limits that matter here.
- **Claude (if used instead):** pay-per-token via your own account.

## Updating who's allowed to call this

CORS is locked to a fixed list at the top of `src/index.js`:
```js
const ALLOWED_ORIGINS = [
  "https://ritehomemodular.com",
  "https://www.ritehomemodular.com",
  "https://bernadosjason-dev.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];
```
Add an origin here and run `wrangler deploy` again if the domain
changes or you test from a different local port.

## Tuning when it escalates to Telegram

Two layers, both in `src/index.js`:

1. The model's own judgement — instructions live in `RESPONSE_FORMAT`.
   Edit the criteria there if it's escalating too often or not often
   enough.
2. A fixed phrase list, `HUMAN_TRIGGER_PHRASES` — these always page
   you regardless of what the model decides (e.g. "complaint",
   "refund", "manager"). Add or remove phrases as you learn what
   actually needs a human versus what Hannah handles fine.

She only pages you **once per visitor's chat session**, not once per
message — `assets/hannah.js` remembers locally that a session already
escalated and tells the worker (`already_escalated` in the request),
which skips the repeat Telegram send but still answers normally. A
new page load (visitor closes the tab and comes back, or a different
visitor entirely) starts a fresh session and can alert again.

## Updating what Hannah knows

Her facts live in `FACTS` in `src/index.js`. If a price, a service, or
a policy changes on the real site, update it there too — she only
knows what's written in that prompt, on purpose, so she can't invent
something that isn't true.

`FACTS` also carries a `PRICING` table — small/medium/large ballpark
₱ ranges per system × spec tier, so Hannah can give a visitor a rough
estimate in conversation without a human quoting it live. These
numbers are derived from RiteHome's real internal quoting tools, kept
deliberately as ranges, and deliberately stop at the final total — no
supplier cost, multiplier, or per-unit rate from those tools belongs
in this file or anywhere public. If the internal rates move materially,
re-derive the ranges and update this table; nothing recalculates it
automatically.

## Troubleshooting: Hannah always gives canned answers, no Telegram alerts ever fire

Symptoms: `curl` against the worker directly works fine, `assets/hannah.js`
on the live site clearly has the right `HANNAH_ENDPOINT`, but every reply
in the chat widget matches her offline fallback text word-for-word, and
`wrangler tail` shows zero incoming requests no matter what you ask.

Cause: **ritehomemodular.com has its own Content-Security-Policy response
header, set on the Cloudflare zone itself** (Rules → Transform Rules →
Modify Response Header), not in this repo. Its `connect-src` was `'self'`
only — meaning the browser silently blocks the page from ever calling out
to the worker's `*.workers.dev` address, with no error shown to the
visitor. Confirm this is happening via the browser's own DevTools Console
(F12) while sending a message — the CSP violation shows up in red there,
even though nothing about it appears in this codebase.

Fix: in that same Transform Rule, add the worker's origin to `connect-src`:
```
connect-src 'self' https://ritehome-hannah.ritehome.workers.dev;
```
If the worker is ever renamed or redeployed under a different `wrangler.toml`
`name` or a different `workers.dev` subdomain, **that CSP rule needs the new
URL added too** — this repo has no way to know that rule exists, so nothing
here will remind you.
