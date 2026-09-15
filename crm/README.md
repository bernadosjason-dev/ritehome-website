# RiteHome CRM — Build 1

One record per lead, from first Messenger message to install-complete. Replaces
manual tracking. This is Build 1: the record store plus automatic lead capture.
Stage moves are still manual — that's intentional, see below.

## 1. Pipeline stages

Six stages, collapsed from the full Discover → Complete journey down to what
sales actually needs to act on:

| Stage | Means |
|---|---|
| **New Inquiry** | First Messenger message came in. Not yet qualified or quoted. |
| **Quoted** | A price has been given, verbally or written. Waiting on the client. |
| **Design Deposit Paid** | ₱5,000 deposit received, drawing stage opened. |
| **In Fabrication** | Order confirmed (50% paid), being built. |
| **Delivered/Installed** | On site or installed, balance (40%) due/collected. |
| **Complete** | Final 10% collected, job closed. |

## 2. The record store

Google Sheet, not Airtable — free, and everyone already has a Google account.

**[RiteHome CRM — Leads](https://docs.google.com/spreadsheets/d/1U6c41O-qspgtQrSWLghRyt6ijfEo-gSIPs8-_e5oE_c/edit)**

Columns: `Client Name | Contact | Project Type | Stage | Quote Amount | Sales In-Charge | Date | Notes`

Columns J onward hold the six valid Stage values as a plain reference list —
turn that into a real dropdown (2 minutes, one-time):
1. Select the `Stage` column (D2:D1000).
2. Data → Data validation → Add rule → Criteria: **Dropdown (from a range)** → `J2:J7`.
3. On invalid data: Reject input. Save.

The sheet ships with one example row (marked `EXAMPLE ROW — delete before use`)
showing the expected format. Delete it before this goes live — n8n's dedupe
check will otherwise think PSID `1234567890123456` is a real, already-known lead.

Stage moves are manual: you or sales edit the Stage cell directly. Nothing in
Build 1 changes a stage automatically — that's Build 2, once this sheet is
trusted and the team is actually using it.

## 3. n8n workflow: Messenger → New Inquiry row

File: [`n8n-workflow-new-inquiry.json`](./n8n-workflow-new-inquiry.json) —
import it in n8n (Workflows → Import from File).

What it does, in order:
1. **Messenger Webhook** — one n8n Webhook node, both GET (Meta's one-time
   verification handshake) and POST (real events), same URL.
2. **Is Verification Request?** → checks `hub.mode=subscribe`. If yes, checks
   the verify token matches and echoes back `hub.challenge` (or 403s on a
   mismatch). This branch only ever fires once, when you save the webhook in
   Meta's dashboard.
3. Every real POST gets an immediate `200 EVENT_RECEIVED` (Meta requires a
   fast ack), then:
4. **Extract Messages** — splits the batch into one item per message, drops
   the page's own echoed messages and non-text events (read receipts,
   postbacks).
5. **Get Sender Profile** — calls the Graph API for the sender's first/last
   name using your Page Access Token.
6. **Check Existing Lead** — looks up the Contact column for this PSID. If
   found, does nothing (one record per lead — a second message from someone
   already in the sheet shouldn't spawn a duplicate row or touch their stage).
7. **Build New Row** + **Create Row in Leads Sheet** — appends Client Name,
   Contact (PSID), Stage=`New Inquiry`, Date, and the first message as a Note.
   Project Type, Quote Amount, and Sales In-Charge are left blank for sales to
   fill in.

### Setup

**A. Meta side (Facebook Developer dashboard)**
1. [developers.facebook.com](https://developers.facebook.com) → Create App →
   type "Business" → add the **Messenger** product.
2. Messenger → Settings → under your Page, generate a **Page Access Token**.
   Copy it.
3. Messenger → Settings → Webhooks → paste the n8n webhook URL (from step B4
   below) as Callback URL, invent any string as Verify Token, subscribe to the
   `messages` field, then click **Verify and Save**.
4. Your Page needs to be added under App Roles (or the app in Live mode) for
   webhooks to actually fire — a fresh dev-mode app only delivers to admins/
   testers of that app until reviewed.

**B. n8n side**
1. Import `n8n-workflow-new-inquiry.json`.
2. Create a **Google Sheets OAuth2** credential (sign in as
   `bernados.jason@gmail.com`, the sheet's owner) and attach it to both
   **Check Existing Lead** and **Create Row in Leads Sheet**.
3. Open the **Config** node, replace `REPLACE_WITH_YOUR_VERIFY_TOKEN` with the
   same string you typed into Meta in step A3, and
   `REPLACE_WITH_YOUR_PAGE_ACCESS_TOKEN` with the token from step A2. The
   spreadsheet ID is already filled in.
4. Activate the workflow, open the **Messenger Webhook** node, copy its
   **Production URL** — that's what goes into Meta step A3.
5. Go back and finish step A3 with that URL, then verify/save.

### Testing

- Message the Page from a personal account (not the page's own admin account —
  Meta doesn't deliver a page's own messages back to itself) → a new row
  should appear in the sheet within a few seconds, Stage `New Inquiry`.
- Message again from the same account → no second row.
- In n8n, check the execution log on any failure — the most common one is the
  Google Sheets nodes still pointing at a placeholder credential.

### Honesty check on this file

This JSON was built from n8n's current node source and public docs, not
tested against a live n8n instance — the n8n connector wasn't reachable in
this session. Import it and expect to re-pick the credential and possibly the
sheet name in the two Google Sheets nodes (n8n often needs that after an
import even when the underlying IDs are correct). If a node's parameters look
broken after import, rebuild that one node by hand using the description above
— the logic is the part that matters, not the exact JSON.

## What's next (not Build 1)

- Automatic stage transitions (payment received → auto-move to Design Deposit
  Paid, etc.)
- Capturing phone/email instead of just a Messenger PSID
- Reminders for stalled leads (e.g. Quoted for 7+ days, no follow-up)
