# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

The marketing site and lead-generation tooling for Ritehome Modular Systems, a modular cabinetry / interior fit-out company in Cagayan de Oro, Philippines. Live at `ritehomemodular.com` (see `CNAME`). Static HTML/CSS/JS — no framework, no build step, no `package.json` at the repo root.

Three parts, each deployed independently:
1. **The site itself** — static files, served as-is (GitHub Pages / Cloudflare).
2. **`cloudflare-worker/`** — "Hannah," the site's AI chat widget's backend. Deployed with Wrangler.
3. **`google-apps-script/`** — the inquiry form's backend. Deployed by hand through the Apps Script web editor (no CLI for this one).

## Commands

Preview the static site locally:
```
python3 -m http.server 8000
```
(`http://localhost:8000` and `http://127.0.0.1:8000` are already in the Worker's CORS allowlist for this reason.)

Deploying Hannah's backend after editing `cloudflare-worker/src/index.js` **is automatic**: `.github/workflows/deploy-hannah.yml` runs `wrangler deploy` on every push to `main` that touches `cloudflare-worker/`, authenticated with a `CLOUDFLARE_API_TOKEN` GitHub Actions secret. Merge to `main` and it ships — check the repo's **Actions** tab if it doesn't.

**Do not try to `wrangler deploy` from inside a Claude Code session.** This environment's own sandbox network policy blocks outbound connections to `api.cloudflare.com` (confirmed via `curl -sS "$HTTPS_PROXY/__agentproxy/status"` — a `connect_rejected` / 403 policy denial, not a token or auth problem). No token, secret, or wrangler config fixes that; the GitHub Actions workflow above is the only path that actually reaches Cloudflare. A `.claude/hooks/session-start.sh` SessionStart hook still installs `wrangler` locally each session for manual/local testing outside of `main`, but it cannot and should not be used to deploy from here.

There is no linter, formatter, or test suite in this repo — nothing to run beyond the above.

## Architecture

### `index.html` — one file, two modes
The homepage is a single ~2500-line file with no client-side router. It has two mutually exclusive display modes, toggled by JS at the bottom of the file (exposed as `window.RitehomeApp` so `assets/hannah.js` can call into it):
- **Stage mode** (default): a full-screen "slide deck" of `.slide` sections (portfolio shots, the design-team page, materials, the exploded module diagram, the four-systems overview, durability) navigated with `go(i)`.
- **Reading mode**: `.docsec` sections (process sequence, commercial terms/tiers, the inquiry form, FAQ, per-project detail pages, per-system photo galleries) revealed by `showDoc(id)` and dismissed by `showStage()`.

The three service pages (`kitchen-cabinets-cdo/`, `partitions-cdo/`, `interior-design-cdo/`) are separate static pages that deep-link back into the homepage's reading-mode sections via `../index.html#<id>`.

### The four systems × three tiers taxonomy
Everything Ritehome sells is framed as one of **Kitchen / Storage / Partition / Workspace**, each offered at one of three spec tiers — **Essential / Premium / Executive**. This exact language is duplicated in three places that must stay in sync: `index.html` (the tiers section), `assets/hannah.js`'s local KB, and `cloudflare-worker/src/index.js`'s `FACTS`. If tier names, systems, or their descriptions change on the site, update all three.

### Hannah (`assets/hannah.js` + `cloudflare-worker/`)
The chat widget works two ways depending on whether `HANNAH_ENDPOINT` (in `hannah.js`) is reachable:
- **No backend / backend unreachable**: `respondLocally()` keyword-matches against a hardcoded `KB` array — always available, never invents an answer, deliberately vague on pricing.
- **Backend reachable**: the Cloudflare Worker's `FACTS` + `RESPONSE_FORMAT` system prompt drives Gemini (default) → Claude → Cloudflare Workers AI, in that fallback order based on which API key secret is set. The model returns `{reply, needs_human, reason, chips}`; `needs_human: true` pages Telegram (throttled to once per visitor session).
- **Chips**: short tap-able button labels the model can return alongside a reply (e.g. `["Kitchen","Storage","Partition","Workspace"]`) so a visitor can tap instead of type. Sanitized (count- and length-capped, rendered via `textContent` not `innerHTML`) on both the Worker and the widget, since the AI backend chooses the label text.
- **Pricing is a closely-scoped exception to "never invent a number"**: `FACTS` carries a small/medium/large × Essential/Premium/Executive `PRICING` table, in whole-system peso ranges only. Ritehome quotes per system as one total — Hannah is explicitly forbidden (in three separate places in the prompt, deliberately redundant) from ever giving a per-material, per-unit, or per-square/linear-metre price, even if asked directly or pressed to "just do the math."
- These ranges were derived from Ritehome's real internal per-project pricing-estimator tools (four private, unpublished HTML/JS apps — Kitchen, Closet & Cabinet, CR Partition, Office Tables & Partitions — not in this repo). Those tools' supplier costs, markup multipliers, and per-unit rates must never appear in this repo or in anything Hannah says; only final, banded totals may cross that boundary. If Ritehome's real rates move, the `PRICING` table has to be re-derived and hand-updated — nothing here recalculates it.

### The inquiry form (`index.html`'s `#inquiry` section + `google-apps-script/Code.gs`)
Posts to an Apps Script web app (`INQ_ENDPOINT` in `index.html`) that dedupes submissions by name/phone/email into a Google Sheet, incrementing "Times Inquired" on repeats rather than adding new rows. Falls back to opening the visitor's mail client if the endpoint is empty or unreachable. Redeploying `Code.gs` must use **Manage deployments → Edit → New version** to keep the same `/exec` URL — a fresh deployment issues a different URL and breaks `INQ_ENDPOINT` until it's updated.

### The CSP gotcha
`ritehomemodular.com`'s Cloudflare zone has its own Content-Security-Policy Transform Rule that is **not in this repo** (Rules → Transform Rules → Modify Response Header, in the Cloudflare dashboard). Its `connect-src` has to list any origin the browser needs to call — Hannah's worker, the Apps Script `/exec` URL. If a backend is reachable by `curl` but the live site silently never calls it (no console error, requests just don't fire), this is almost always why. See `cloudflare-worker/README.md`'s troubleshooting section.

### Standing product decisions worth not re-litigating
- The Facebook Messenger BOM-quotation-bot idea was deliberately dropped; Hannah (this repo's existing chat widget) is the one AI-bot surface for pricing conversations, not Messenger and not the separate (and last known to be broken) n8n "RiteHome Instant BOM from Tally Quote" workflow.
- Never surface a static price-lookup table or the internal estimator tools on the public site — pricing conversation happens through Hannah only, per the scoping above.
