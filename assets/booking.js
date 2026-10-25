/* ============================================================
   RITEHOME — BOOKING MODAL
   A "book a call or site visit" popup in front of Google Calendar
   Appointment Schedules: one widget, a Call / Site visit toggle on
   top, Google's real booking page (actual open slots on the team's
   calendar) inside. Google allows one appointment type per schedule,
   so each type is its own schedule URL below.

   Paste each schedule's embed URL into BOOKING below -- in Google
   Calendar: open the schedule -> Share -> Website embed -> Inline
   -> copy the iframe's src (https://calendar.google.com/calendar/
   appointments/schedules/...). Anything else is ignored.

   Until at least one URL is set, this does nothing at all: elements
   marked [data-book-section] stay hidden and [data-book] links keep
   their normal href, so the page never offers booking that isn't
   actually wired up. The Cloudflare CSP rule's frame-src must allow
   https://calendar.google.com or the panel renders blank.
   ============================================================ */
(function () {
  var BOOKING = {
    visit: {
      url: "",
      name: "Site visit",
      meta: "Free · we measure the space on site"
    },
    call: {
      url: "",
      name: "Call",
      meta: "Talk through your project first"
    }
  };
  var ORDER = ["visit", "call"];
  var FALLBACK_HREF = "/schedule/#request";

  function embedUrl(raw) {
    if (!raw) return "";
    var u;
    try { u = new URL(raw); } catch (e) { return ""; }
    if (u.protocol !== "https:" || u.hostname !== "calendar.google.com" ||
        u.pathname.indexOf("/calendar/appointments/") !== 0) return "";
    u.searchParams.set("gv", "true");
    return u.toString();
  }

  var types = ORDER.filter(function (k) {
    BOOKING[k].src = embedUrl(BOOKING[k].url);
    return !!BOOKING[k].src;
  });
  if (!types.length) return;

  var sections = document.querySelectorAll("[data-book-section]");
  for (var s = 0; s < sections.length; s++) sections[s].hidden = false;

  var overlay, panel, closeBtn, body, loading, typeBtns = {}, frames = {};
  var current = null, lastFocus = null;

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text) n.textContent = text;
    return n;
  }

  function build() {
    overlay = el("div", "bk-overlay");
    overlay.hidden = true;

    panel = el("div", "bk-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-modal", "true");
    panel.setAttribute("aria-labelledby", "bk-title");

    var head = el("div", "bk-head");
    var heading = el("div");
    heading.appendChild(el("p", "bk-eyebrow", "Ritehome Modular Systems"));
    var title = el("h2", "bk-title", types.length > 1 ? "Book a call or site visit" :
      "Book a " + BOOKING[types[0]].name.toLowerCase());
    title.id = "bk-title";
    heading.appendChild(title);
    closeBtn = el("button", "bk-close", "×");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close booking");
    closeBtn.addEventListener("click", close);
    head.appendChild(heading);
    head.appendChild(closeBtn);
    panel.appendChild(head);

    if (types.length > 1) {
      var bar = el("div", "bk-types");
      bar.setAttribute("role", "group");
      bar.setAttribute("aria-label", "What would you like to book?");
      types.forEach(function (k) {
        var b = el("button", "bk-type");
        b.type = "button";
        b.setAttribute("aria-pressed", "false");
        b.appendChild(el("span", "bk-type-name", BOOKING[k].name));
        b.appendChild(el("span", "bk-type-meta", BOOKING[k].meta));
        b.addEventListener("click", function () { select(k); });
        typeBtns[k] = b;
        bar.appendChild(b);
      });
      panel.appendChild(bar);
    }

    body = el("div", "bk-body");
    loading = el("div", "bk-loading", "Loading open times…");
    body.appendChild(loading);
    panel.appendChild(body);

    var foot = el("p", "bk-foot");
    foot.appendChild(document.createTextNode("No time that works? Call "));
    var tel = el("a", null, "+63 917 701 0109");
    tel.href = "tel:+639177010109";
    foot.appendChild(tel);
    foot.appendChild(document.createTextNode(", or "));
    var req = el("a", null, "request a different date");
    req.href = FALLBACK_HREF;
    req.addEventListener("click", close);
    foot.appendChild(req);
    foot.appendChild(document.createTextNode("."));
    panel.appendChild(foot);

    overlay.appendChild(panel);
    overlay.addEventListener("click", function (e) { if (e.target === overlay) close(); });
    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && !overlay.hidden) close();
    });
    document.addEventListener("focusin", function (e) {
      if (!overlay.hidden && !panel.contains(e.target)) closeBtn.focus();
    });
    document.body.appendChild(overlay);
  }

  function select(k) {
    if (current === k) return;
    current = k;
    for (var t in typeBtns) typeBtns[t].setAttribute("aria-pressed", t === k ? "true" : "false");
    for (var f in frames) frames[f].hidden = f !== k;
    if (!frames[k]) {
      var frame = el("iframe", "bk-frame");
      frame.title = "Book a " + BOOKING[k].name.toLowerCase() + " with Ritehome";
      frame.loading = "eager";
      loading.hidden = false;
      frame.addEventListener("load", function () { if (current === k) loading.hidden = true; });
      frame.src = BOOKING[k].src;
      frames[k] = frame;
      body.appendChild(frame);
    } else {
      loading.hidden = true;
    }
  }

  function open(k) {
    if (!overlay) build();
    lastFocus = document.activeElement;
    select(types.indexOf(k) >= 0 ? k : (current || types[0]));
    overlay.hidden = false;
    document.documentElement.classList.add("bk-lock");
    requestAnimationFrame(function () { overlay.classList.add("bk-open"); });
    (typeBtns[current] || closeBtn).focus();
  }

  function close() {
    if (!overlay || overlay.hidden) return;
    overlay.classList.remove("bk-open");
    overlay.hidden = true;
    document.documentElement.classList.remove("bk-lock");
    if (lastFocus && lastFocus.focus) lastFocus.focus();
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-book]") : null;
    if (!t) return;
    e.preventDefault();
    open(t.getAttribute("data-book"));
  });

  window.RitehomeBooking = { open: open, close: close };
})();
