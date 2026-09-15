# Hannah's backend (Cloudflare Worker)

This is the optional AI backend for Hannah, the chat widget on
ritehomemodular.com (`assets/hannah.js`). Without it, Hannah still
works — she answers from a built-in FAQ list. This worker upgrades
her to a real language model, using the same conversation history
she already keeps in the browser.

Deploy time: about 10 minutes, first time.

## 1. Prerequisites

- **Node.js** installed (18+). Check with `node -v`.
- A **Cloudflare account** — free, no card required for what's here.
  [dash.cloudflare.com/sign-up](https://dash.cloudflare.com/sign-up)

## 2. Install Wrangler (Cloudflare's CLI)

```
npm install -g wrangler
```

## 3. Log in

```
wrangler login
```

Opens a browser tab to authorize. Approve it, come back to the terminal.

## 4. Deploy

From **this directory** (`cloudflare-worker/`):

```
cd cloudflare-worker
wrangler deploy
```

That's it for the default setup — no API key needed. This uses
**Cloudflare Workers AI** (a Llama model running on Cloudflare's own
infrastructure), which is free up to a generous daily limit, more
than enough for a small business FAQ bot.

Wrangler prints a URL when it finishes, something like:

```
https://ritehome-hannah.<your-subdomain>.workers.dev
```

That's Hannah's new brain. Copy it.

## 5. Point Hannah at it

Open `assets/hannah.js` at the repo root, find this line near the top:

```js
var HANNAH_ENDPOINT = "";
```

Paste the URL from step 4 in between the quotes:

```js
var HANNAH_ENDPOINT = "https://ritehome-hannah.<your-subdomain>.workers.dev";
```

Commit and push. Hannah now calls the worker instead of only her
local FAQ list — and if the worker ever fails or is unreachable, she
falls back to that local list automatically, so she's never silent.

## 6. Test it directly (optional)

```
curl -X POST "https://ritehome-hannah.<your-subdomain>.workers.dev" \
  -H "Content-Type: application/json" \
  -d '{"message":"Are your cabinets termite-proof?"}'
```

Should return `{"reply": "..."}`.

## Want Claude instead of the free default?

Claude gives noticeably better answers on anything conversational or
slightly off-script, for a small per-message cost (a FAQ bot's
message volume costs a few cents to a few pesos a month on Claude
Haiku, not more). To switch:

```
cd cloudflare-worker
wrangler secret put ANTHROPIC_API_KEY
```

Paste your Anthropic API key when prompted (get one at
[console.anthropic.com](https://console.anthropic.com) — needs
billing set up there). Nothing else changes; the worker automatically
uses Claude once that secret exists, and falls back to Workers AI if
it's ever removed. Redeploy after setting it:

```
wrangler deploy
```

## Costs and limits

- **Workers AI (default):** free tier includes 10,000 "neurons" a
  day — a FAQ bot for a local business will not come close to that.
- **The Worker itself:** Cloudflare's free plan includes 100,000
  requests/day, effectively unlimited for this.
- **Claude (optional):** pay-per-token via your own Anthropic account.
  Haiku is the cheap, fast model — this worker defaults to it.

## Updating who's allowed to call this

The worker only answers requests from an allowed origin (CORS), listed
at the top of `src/index.js`:

```js
const ALLOWED_ORIGINS = [
  "https://ritehomemodular.com",
  "https://www.ritehomemodular.com",
  "https://bernadosjason-dev.github.io",
  "http://localhost:8000",
  "http://127.0.0.1:8000"
];
```

If the domain ever changes, or you test from a different local port,
add it here and run `wrangler deploy` again.

## Updating what Hannah knows

Her facts live in one place in `src/index.js`: the `SYSTEM_PROMPT`
constant. If a price, a service, or a policy changes on the real
site, update it there too — she only knows what's written in that
prompt, on purpose, so she can't invent something that isn't true.
