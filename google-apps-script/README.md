# Inquiry logger (Google Apps Script)

Logs every submission of the site's inquiry form (`#inquiry` on the
homepage) to a Google Sheet — name, phone, email, product line, site
location, notes. A submission that matches an existing row on **name,
phone, or email** (any one is enough) updates that row instead of adding
a new one, so the sheet never carries duplicate people. Repeat inquiries
still count: the matched row's "Times Inquired" goes up and the new notes
are appended, dated, under the old ones.

The sheet already exists, headers and all:
**[Ritehome Website Inquiries](https://docs.google.com/spreadsheets/d/1e_E9_2VbYB0wSu70OwcyDwYmzsPUpisgrb8WrP4ZeZs/edit)**
— it's in the same Google account as this repo's Drive/Gmail connectors.
All that's left is attaching the script below to it and deploying it as a
web app.

Deploy time: about 10 minutes.

**`Code.gs` is a standalone script, not container-bound** — it opens the
sheet by ID (`SPREADSHEET_ID` near the top of the file) via
`SpreadsheetApp.openById(...)` rather than relying on
`getActiveSpreadsheet()`. That's deliberate: it means the project lives
at its own `script.google.com` URL and doesn't depend on opening it
*through* the sheet's own **Extensions → Apps Script** menu, which has a
real failure mode — a stale/wrong signed-in Google account in the
browser (multiple accounts signed in, `authuser=1` instead of the right
one) makes that specific path fail with a generic Drive "can't open this
file" error that has nothing to do with the script or the sheet actually
being broken. Deploying standalone sidesteps that path entirely. The
one-time setup below (step 1) reflects this.

## 1. Create the standalone project

Go to **[script.new](https://script.new)** signed into the Google
account that owns the sheet above — this opens a brand-new, blank
Apps Script project directly, with no dependency on the sheet's own
editor. (If `script.new` doesn't redirect for you, use
[script.google.com/home](https://script.google.com/home) → **New
project**.) Rename it something like "Ritehome Inquiry Logger" (top
left, next to the Apps Script logo).

## 2. Paste the script

Delete the placeholder `myFunction() {}` and paste in the full contents
of [`Code.gs`](./Code.gs) from this folder. Save (Ctrl/Cmd+S).

## 3. Deploy as a web app

1. **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Description: anything (e.g. "inquiry logger").
4. **Execute as:** Me (your account).
5. **Who has access:** Anyone.
6. Click **Deploy**.
7. Google will ask you to authorize the script (it's unverified because
   it's your own project, not a published one) — click **Authorize
   access**, pick your account, then **Advanced → Go to Ritehome Inquiry
   Logger (unsafe) → Allow**. This is expected and safe; it's you
   authorizing your own script to edit your own sheet.
8. Copy the **Web app URL** shown (ends in `/exec`).

## 4. Wire it into the site

The URL from step 3 goes in **two** files — `index.html` (the `#inquiry`
section) and `schedule/index.html` (the site-visit request form), both
of which have their own:
```js
var INQ_ENDPOINT = "...";
```
Paste the same URL into both, commit, push. Both forms now post straight
to the sheet — and if the endpoint is ever empty or unreachable, each
falls back to opening the visitor's mail app instead of failing
silently.

If `cloudflare-worker`'s optional `APPS_SCRIPT_URL` secret was ever set
to a *previous* `/exec` URL (see `cloudflare-worker/README.md` step 5 —
it's what lets Hannah-captured leads also land as Sheet rows), update it
to this new URL too: `wrangler secret put APPS_SCRIPT_URL`, run locally
— this can't be run from inside a Claude Code session (see the top-level
`CLAUDE.md`'s note on why `wrangler deploy` can't run from here either).

## 5. Test it

1. Open the deployed URL directly in a browser — it should show
   `{"ok":true,"message":"Ritehome inquiry logger is running."}`.
2. Submit the inquiry form on the live site with a test name/phone/email.
   A new row should appear in the sheet within a couple of seconds.
3. Submit it again with the same email (or phone, or name) but different
   notes. Confirm it updates that same row — "Times Inquired" becomes 2,
   the new note is appended under the old one — rather than adding a
   second row.

## 6. Telegram notifications (recommended)

Without this, a submission only ever becomes a spreadsheet row — nothing
alerts anyone in real time. Hannah (the site's chat widget) already pages
a Telegram bot when she needs a human; reuse that same bot here so both
channels back the same 2-business-hour response commitment.

1. **Get the bot's token again.** In Telegram, message **@BotFather** →
   `/mybots` → pick the bot Hannah already uses → **API Token**. This
   redisplays the existing token (doesn't rotate it, so Hannah's setup in
   `cloudflare-worker/` is untouched) — copy it.
2. **Get the chat ID.** Same one already used for
   `cloudflare-worker`'s `TELEGRAM_CHAT_ID` secret — if you don't have it
   saved, `cloudflare-worker/README.md` step 4 explains how to look it up
   again via the bot's `getUpdates` endpoint.
3. **Add both as Script Properties** (this project's equivalent of
   secrets — never paste these into `Code.gs` itself):
   - In the Apps Script editor (the tab from step 1), click the **gear
     icon** ("Project Settings") in the left sidebar.
   - Scroll to **Script Properties** → **Add script property**.
   - Add `TELEGRAM_BOT_TOKEN` with that token as its value.
   - Add another: `TELEGRAM_CHAT_ID` with that chat ID as its value.
   - Click **Save script properties**.
4. **Redeploy** so the updated `Code.gs` (with the new `notifyTelegram_`
   call) actually runs: **Deploy → Manage deployments → the pencil
   (Edit) icon → Version: New version → Deploy**. This keeps the same
   `/exec` URL — see "Updating the script later" below.
5. **Test**: submit the inquiry form on the live site. A Telegram message
   should arrive within a couple of seconds, alongside the new sheet row.

Leaving either property unset is safe — `notifyTelegram_` just does
nothing, and the sheet logging (the part that actually matters) is
unaffected either way.

## 7. One-time: add the Address and Preferred Visit Date columns

The site-visit request form (`/schedule/`) posts two extra fields —
address and preferred visit date — through this same endpoint, appended
as trailing columns so they never shift any existing column's position.

1. **Header cells** — done. The sheet's header row now has `Address` in
   column J and `Preferred Visit Date` in column K (added directly via
   the Sheets API; `ensureHeaders` in `Code.gs` only writes the header row
   on a completely empty sheet, so on an already-populated sheet these
   have to be added once, separately from the script).
2. **Redeploy — still to do.** Paste the current `Code.gs` into the Apps
   Script editor and redeploy the same way as step 6.4 above (**Manage
   deployments → the pencil icon → Version: New version → Deploy**) —
   keeps the same `/exec` URL, so nothing else needs to change. Until
   this is done, submissions from `/schedule/` still log a row, just
   without the address/visit-date columns filling in (the live script
   predates them).

## 8. The "Confirmed" column (manual, admin use)

Column L, header `Confirmed`, with a Pending/Confirmed/Declined dropdown
on it (data validation, rows 2–1000). This is **not** in `Code.gs`'s
`HEADERS` array and the script never reads or writes it — it exists
purely for whoever's managing the sheet by hand:

- Tick a site-visit row to **Confirmed** once you've actually agreed the
  date with the visitor, or **Declined** if it didn't work out. Leave new
  rows at **Pending** (the dropdown's default blank reads as pending too).
- To log a phone-in or walk-in visit that never went through the website
  form, just add a row by hand with the same columns.
- Because this column sits outside `HEADERS`, future script edits that
  only ever append new columns at the end (per the discipline in
  `CLAUDE.md`) will never collide with it or shift it — but don't insert
  a new column before L, since that would shift it out from under the
  dropdown's range.

## Updating the script later

Since this is a standalone project (see the top of this file), reopen it
at [script.google.com/home](https://script.google.com/home) — it's in
your own project list there, not behind the sheet's Extensions menu. If
you edit `Code.gs` again, use **Deploy → Manage deployments → the
pencil (Edit) icon → Version: New version → Deploy**. This keeps the same
`/exec` URL. Using **New deployment** instead issues a *different* URL,
which means editing `INQ_ENDPOINT` in both `index.html` and
`schedule/index.html` again — only do that on purpose.

## Security and spam notes

- The web app is deployed with **Anyone** access because it's called from
  a public website with no logged-in visitors. That also means anyone who
  discovers the URL could POST rows into the sheet directly, bypassing
  the form's honeypot field. Apps Script's own execution quotas cap how
  much damage that can do; if it becomes a real problem, add a shared
  secret parameter that `doPost` checks before writing.
- `Code.gs` neutralises any cell that starts with `=`, `+`, `-` or `@`
  (CSV/formula-injection characters) before writing it, in case the sheet
  is ever exported to CSV and opened in Excel.
- The site has a Content-Security-Policy rule on its Cloudflare zone
  (separate from this repo — see `../cloudflare-worker/README.md`'s
  troubleshooting section for where). If inquiries silently stop logging
  after this is wired up, check that CSP's `connect-src` allows
  `https://script.google.com`, the same way it needed to allow the
  Hannah worker's origin.
