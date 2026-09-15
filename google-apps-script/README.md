# Enquiry logger (Google Apps Script)

Logs every submission of the site's enquiry form (`#enquiry` on the
homepage) to a Google Sheet — name, phone, email, product line, site
location, notes. A submission that matches an existing row on **name,
phone, or email** (any one is enough) updates that row instead of adding
a new one, so the sheet never carries duplicate people. Repeat enquiries
still count: the matched row's "Times Inquired" goes up and the new notes
are appended, dated, under the old ones.

The sheet already exists, headers and all:
**[Ritehome Website Enquiries](https://docs.google.com/spreadsheets/d/1e_E9_2VbYB0wSu70OwcyDwYmzsPUpisgrb8WrP4ZeZs/edit)**
— it's in the same Google account as this repo's Drive/Gmail connectors.
All that's left is attaching the script below to it and deploying it as a
web app.

Deploy time: about 10 minutes.

## 1. Open the sheet's script editor

Open the [sheet](https://docs.google.com/spreadsheets/d/1e_E9_2VbYB0wSu70OwcyDwYmzsPUpisgrb8WrP4ZeZs/edit),
then **Extensions → Apps Script**. A new tab opens with a blank
`Code.gs`.

## 2. Paste the script

Delete the placeholder `myFunction() {}` and paste in the full contents
of [`Code.gs`](./Code.gs) from this folder. Save (Ctrl/Cmd+S). Name the
project something like "Ritehome Enquiry Logger" when prompted.

## 3. Deploy as a web app

1. **Deploy → New deployment**.
2. Click the gear icon next to "Select type" → **Web app**.
3. Description: anything (e.g. "enquiry logger").
4. **Execute as:** Me (your account).
5. **Who has access:** Anyone.
6. Click **Deploy**.
7. Google will ask you to authorize the script (it's unverified because
   it's your own project, not a published one) — click **Authorize
   access**, pick your account, then **Advanced → Go to Ritehome Enquiry
   Logger (unsafe) → Allow**. This is expected and safe; it's you
   authorizing your own script to edit your own sheet.
8. Copy the **Web app URL** shown (ends in `/exec`).

## 4. Wire it into the site

Open `index.html` at the repo root, find:
```js
var ENQ_ENDPOINT = "";
```
Paste the URL from step 3 between the quotes, commit, push. The form now
posts straight to the sheet — and if the endpoint is ever empty or
unreachable, it falls back to opening the visitor's mail app instead of
failing silently.

## 5. Test it

1. Open the deployed URL directly in a browser — it should show
   `{"ok":true,"message":"Ritehome enquiry logger is running."}`.
2. Submit the enquiry form on the live site with a test name/phone/email.
   A new row should appear in the sheet within a couple of seconds.
3. Submit it again with the same email (or phone, or name) but different
   notes. Confirm it updates that same row — "Times Inquired" becomes 2,
   the new note is appended under the old one — rather than adding a
   second row.

## Updating the script later

If you edit `Code.gs` again, use **Deploy → Manage deployments → the
pencil (Edit) icon → Version: New version → Deploy**. This keeps the same
`/exec` URL. Using **New deployment** instead issues a *different* URL,
which means editing `ENQ_ENDPOINT` in `index.html` again — only do that on
purpose.

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
  troubleshooting section for where). If enquiries silently stop logging
  after this is wired up, check that CSP's `connect-src` allows
  `https://script.google.com`, the same way it needed to allow the
  Hannah worker's origin.
