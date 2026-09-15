/**
 * Ritehome inquiry logger — Google Apps Script web app.
 *
 * Receives the inquiry form's POST (name, phone, email, line, location,
 * notes as application/x-www-form-urlencoded) and logs it to the sheet
 * this script is bound to. A submission that matches an existing row on
 * name, phone, or email (any one is enough) updates that row instead of
 * adding a new one, so the sheet never carries duplicate people.
 *
 * Setup: see README.md in this folder.
 */

var HEADERS = [
  "Timestamp", "Name", "Phone", "Email", "Product Line",
  "Site Location", "Notes", "Times Inquired", "Last Inquiry"
];

function doPost(e) {
  var lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    var p = (e && e.parameter) || {};
    var name = clean(p.name);
    var phone = clean(p.phone);
    var email = clean(p.email);
    var line = clean(p.line);
    var location = clean(p.location);
    var notes = clean(p.notes);

    if (!name || (!phone && !email)) {
      return respond({ ok: false, error: "Name and a phone or email are required." });
    }

    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    ensureHeaders(sheet);

    var normName = name.toLowerCase();
    var normPhone = normalizePhone(phone);
    var normEmail = email.toLowerCase();

    var rows = sheet.getDataRange().getValues();
    var matchRow = -1;
    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      var rowName = String(row[1] || "").toLowerCase();
      var rowPhone = normalizePhone(String(row[2] || ""));
      var rowEmail = String(row[3] || "").toLowerCase();
      if ((normPhone && rowPhone && rowPhone === normPhone) ||
          (normEmail && rowEmail && rowEmail === normEmail) ||
          (normName && rowName && rowName === normName)) {
        matchRow = i + 1; // 1-indexed sheet row
        break;
      }
    }

    var now = new Date();

    if (matchRow === -1) {
      sheet.appendRow([now, name, phone, email, line, location, notes, 1, now]);
      return respond({ ok: true, action: "added" });
    }

    var range = sheet.getRange(matchRow, 1, 1, HEADERS.length);
    var existing = range.getValues()[0];
    var existingNotes = String(existing[6] || "");
    var timesInquired = Number(existing[7] || 1) + 1;

    existing[2] = phone || existing[2];
    existing[3] = email || existing[3];
    existing[4] = line || existing[4];
    existing[5] = location || existing[5];
    existing[6] = notes
      ? existingNotes + (existingNotes ? "\n" : "") + "[" + formatDate(now) + "] " + notes
      : existingNotes;
    existing[7] = timesInquired;
    existing[8] = now;
    range.setValues([existing]);

    return respond({ ok: true, action: "updated" });
  } finally {
    lock.releaseLock();
  }
}

function ensureHeaders(sheet) {
  if (sheet.getLastRow() === 0) {
    sheet.appendRow(HEADERS);
  }
}

/* Neutralise CSV/formula injection (a cell starting with =, +, -, @) before
   it ever lands in a sheet someone might later export or open in Excel. */
function clean(v) {
  var s = String(v == null ? "" : v).trim();
  if (/^[=+\-@]/.test(s)) s = "'" + s;
  return s;
}

/* Collapses the usual ways a PH mobile number gets typed (+639171234567,
   639171234567, 09171234567, 9171234567) to one comparable form. */
function normalizePhone(phone) {
  var digits = String(phone || "").replace(/\D/g, "");
  if (!digits) return "";
  if (digits.indexOf("63") === 0 && digits.length === 12) digits = "0" + digits.slice(2);
  if (digits.length === 10 && digits.indexOf("9") === 0) digits = "0" + digits;
  return digits;
}

function formatDate(d) {
  return Utilities.formatDate(d, Session.getScriptTimeZone() || "Asia/Manila", "MMM d, yyyy");
}

function respond(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/* Open the deployed web app URL directly in a browser to sanity-check the
   deployment (should show { ok: true, ... }) without touching the sheet. */
function doGet(e) {
  return respond({ ok: true, message: "Ritehome inquiry logger is running." });
}
