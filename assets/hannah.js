/* ============================================================
   HANNAH — Ritehome's FAQ assistant
   A small, honest, scripted assistant: it matches what you type
   against the FAQ already published across the site (plus a few
   standing facts — deposit, delivery, tiers, contact) and answers
   from that. It does not invent answers, and it says so up front.

   Wiring a real LLM in later: set HANNAH_ENDPOINT to a serverless
   proxy that holds the API key server-side (never put an API key
   in this file — it ships to every visitor's browser). Hannah POSTs
   {message: "...", history: [{role:"user"|"bot", text:"..."}, ...]}
   as JSON and expects {reply: "..."} back. Left empty, she answers
   from KB below instead of failing silently — same fallback pattern
   as the enquiry form's ENQ_ENDPOINT. A ready-made Cloudflare Worker
   for HANNAH_ENDPOINT lives in /cloudflare-worker — see its README.
   ============================================================ */
(function () {
  "use strict";

  var HANNAH_ENDPOINT = "https://ritehome-hannah.ritehome.workers.dev";

  var CONTACT = {
    phone: "+63 917 701 0109",
    tel: "+639177010109",
    email: "ritehomemodularsystems@gmail.com",
    address: "E & J Building, Apovel, Cagayan de Oro City, Misamis Oriental"
  };

  /* ---------------- knowledge base ----------------
     Pulled from the FAQPage schema already live on the homepage and
     the five service pages, plus the standing facts from the
     Engagement (terms) section. Add a Q&A here once; it answers on
     every page that loads this file. */
  var KB = [
    // -------- Kitchen --------
    { q: "Do you install kitchen cabinets in CDO?", kw: ["kitchen", "cabinet", "cabinets", "install", "installer"],
      a: "Yes — kitchen cabinets are our core line. Every run is measured on site, drawn to the millimetre, itemised board by board, and installed in Cagayan de Oro by our own crew, not a subcontractor." },
    { q: "Can you handle a full kitchen renovation?", kw: ["kitchen", "renovation", "renovate", "remodel", "full"],
      a: "Yes. A CDO kitchen renovation runs through the same five tracked stages as any job — consultation, design, procurement, fabrication and installation — with the drawing and quantities approved before demolition or fabrication starts." },
    { q: "What finishes are available for kitchen cabinetry?", kw: ["finish", "finishes", "gloss", "matte", "woodgrain", "colour", "color", "material", "materials"],
      a: "Gloss, matte, woodgrain or solid-colour board, all on the same four-face carcass system, so the finish changes without changing the structure underneath." },
    { q: "What does a kitchen installation cost?", kw: ["cost", "price", "how much", "kitchen", "quotation", "quote", "budget"],
      a: "It depends on the specification tier — Essential, Premium or Executive — agreed line by line against your drawing. A ₱5,000 design deposit opens the drawing stage, so you see the itemised quantity list before committing to a figure." },
    // -------- Storage / wardrobes --------
    { q: "Do you build custom cabinets and wardrobes?", kw: ["wardrobe", "closet", "cabinet", "storage", "custom"],
      a: "Yes. Walk-in wardrobes, TV consoles, open shelving and storage walls are drawn to the exact wall, corner and ceiling height, then built off site and installed as one system." },
    { q: "Can a wardrobe be designed around an odd-shaped room?", kw: ["wardrobe", "odd", "shape", "corner", "alcove", "sloped", "ceiling"],
      a: "That's the point of drawing before building — the elevation is measured against your actual walls, not a standard module width, so an alcove, a sloped ceiling or a corner turn is drawn in, not worked around afterward." },
    { q: "What's the difference between a walk-in closet and a wardrobe run?", kw: ["walk-in", "closet", "wardrobe", "difference"],
      a: "A wardrobe run is a single wall of storage; a walk-in closet is a small room of it — rails, shelving and drawers on more than one wall. Both are drawn and quoted the same way, board by board." },
    { q: "Do you do TV consoles and feature walls?", kw: ["tv", "console", "feature", "wall", "shelving"],
      a: "Yes — TV console walls, backlit feature panels and open shelving towers are part of the storage system, often specified alongside a wardrobe in the same project." },
    // -------- Partitions --------
    { q: "Do you build toilet (CR) partitions?", kw: ["toilet", "cr", "cubicle", "partition", "partitions", "washroom", "bathroom"],
      a: "Yes — toilet cubicle partitions in sealed board and laminate, drawn to the actual washroom layout and installed on stainless or aluminium hardware, are a standing part of our partition system." },
    { q: "Do you do office and reception partitions?", kw: ["office", "reception", "partition", "partitions", "divider", "desk"],
      a: "Yes, both toilet and office/reception partitions. Reception desk partitions, service-window dividers and open-office partitions run through the same drawing and quantity process as our toilet cubicles." },
    { q: "Can partitions be specified with a washroom vanity or counter?", kw: ["vanity", "counter", "basin", "splashback", "washroom"],
      a: "Yes — vanity counters, basins and splashbacks are drawn into the same washroom package as the cubicle partitions, so the whole room is one specification, not separate trades." },
    // -------- Workstations --------
    { q: "Do you design and install office workstations?", kw: ["workstation", "workstations", "desk", "cubicle", "office"],
      a: "Yes — cubicle pods, desk returns and bench-desk runs are drawn against your actual floor plan and headcount, then built off site and installed by our own crew, the same as our kitchens." },
    { q: "Can you fit out a full corporate floor?", kw: ["corporate", "floor", "fit-out", "fitout", "full floor"],
      a: "Yes. Full-floor workstation fit-outs run through the same five-stage process as a single-room job, scaled to however many desks the floor holds." },
    { q: "What's included in a workstation package?", kw: ["workstation", "package", "included", "cubicle", "storage"],
      a: "Desk surfaces, cubicle or screen dividers, overhead or under-desk storage, and cable routing where needed — all itemised in the same bill of quantities as any other Ritehome job." },
    { q: "Do you only work with corporate clients?", kw: ["corporate", "small", "office", "size"],
      a: "No — the process scales down to a single desk run for a small office the same way it scales up to a full floor; the drawing and itemised quantities happen either way." },
    // -------- Interior / positioning --------
    { q: "Is Ritehome an interior designer or a cabinet maker?", kw: ["interior", "designer", "stylist", "decor", "paint"],
      a: "Both, in the sense that matters for a build: we design the built-in interior — kitchens, storage, partitions, workstations — as elevations and quantities, then fabricate and install it ourselves. We don't do furniture styling, decor sourcing or paint schemes." },
    { q: "What does interior design mean for a project like mine?", kw: ["interior", "design", "mean"],
      a: "Every fixed element of the room — cabinetry, storage, partitions, built-in desks — is drawn together as one interior before any of it is built, instead of specifying a kitchen, a wardrobe and a partition as three separate jobs." },
    { q: "Where do I start if I want a full interior?", kw: ["start", "begin", "full interior", "where do i start"],
      a: "The same place as any job — a site visit and measurement. From there we scope which systems apply (kitchen, storage, partitions, workstations) and draw them as one interior." },
    // -------- Durability / termite --------
    { q: "Are Ritehome cabinets termite-proof?", kw: ["termite", "termites", "pest", "bug", "proof", "durable", "durability"],
      a: "Every board is treated against termites before assembly, and every exposed edge is closed with edgebanding, so the treated core is never left open to moisture or termites." },
    { q: "Is durability part of the design, or an add-on?", kw: ["durable", "durability", "add-on", "upgrade", "last", "quality"],
      a: "It's built in, not offered as an upgrade. Every board across every system — kitchen, storage, partitions, workstations — is sealed, edgebanded and treated against termites before it's ever assembled." },
    { q: "What is Ritehome's mission?", kw: ["mission", "promise", "why"],
      a: "“We build kitchens and cabinets that last — sealed, edge-bonded, and termite-treated, so what you invest in today still holds up years from now.” That's the standard behind everything we build." },
    { q: "What is Ritehome's vision?", kw: ["vision", "goal", "future"],
      a: "“To be Northern Mindanao's most trusted modular systems provider — the standard homeowners and businesses turn to for spaces that work better.”" },
    // -------- Process / commercial --------
    { q: "What are the stages of a project?", kw: ["stages", "process", "steps", "how it works", "sequence"],
      a: "Five tracked stages: Consultation, Design Phase, Procurement, Fabrication and Installation. At any point you can ask which stage yours is in and get an answer, not an estimate." },
    { q: "How much is the design deposit?", kw: ["deposit", "downpayment", "down payment", "payment", "terms"],
      a: "A ₱5,000 design deposit opens the drawing stage and is credited against your down payment. From there: 50% on order (once the drawing is approved), 40% on delivery, 10% on completion. All figures are VAT inclusive." },
    { q: "What specification tiers are there?", kw: ["tier", "tiers", "specification", "level", "essential", "premium", "executive"],
      a: "Three tiers, set against your drawing rather than a brochure: Essential (core specification), Premium (upgraded finishes and hardware) and Executive (full specification, counters and accessories opened up)." },
    { q: "Do you deliver, and how much does it cost?", kw: ["delivery", "deliver", "shipping", "far", "distance"],
      a: "Delivery within the first 50 km of Cagayan de Oro is included. Beyond that, delivery is charged in bands of ₱10,000 per 100 km." },
    { q: "Where is Ritehome located?", kw: ["located", "location", "address", "showroom", "where are you"],
      a: "Our showroom is at " + CONTACT.address + "." },
    { q: "How do I contact Ritehome?", kw: ["contact", "phone", "call", "email", "reach", "number"],
      a: "Call or text " + CONTACT.phone + ", or email " + CONTACT.email + ". You can also use the enquiry form on this site to request a site visit." },
    { q: "Which areas do you serve?", kw: ["area", "areas", "serve", "cagayan de oro", "cdo", "mindanao", "misamis"],
      a: "Cagayan de Oro City and the surrounding Misamis Oriental / Northern Mindanao area." }
  ];

  var GREETING_WORDS = ["hi", "hello", "hey", "good morning", "good afternoon", "good evening", "kumusta", "musta"];
  var THANKS_WORDS = ["thank", "thanks", "salamat", "appreciate"];
  var IDENTITY_WORDS = ["are you real", "real person", "actual person", "are you human", "you human",
    "a bot", "a robot", "an ai", "are you ai", "who are you", "what are you", "live agent", "real agent"];

  /* ---------------- matching ---------------- */
  var STOPWORDS = {};
  ["a","an","the","is","are","do","does","did","you","your","yours","i","we","my","me",
   "to","of","for","in","on","at","and","or","with","that","this","it","be","can","how",
   "what","where","when","why","which","much","many","have","has","about","us","from"
  ].forEach(function (w) { STOPWORDS[w] = true; });

  function tokenize(str) {
    return (str.toLowerCase().match(/[a-z0-9']+/g) || []).filter(function (w) {
      return w.length > 1 && !STOPWORDS[w];
    });
  }

  function containsPhrase(haystack, phrase) {
    return haystack.toLowerCase().indexOf(phrase) !== -1;
  }

  function scoreEntry(rawQuery, tokens, entry) {
    var score = 0;
    var qTokens = tokenize(entry.q);
    tokens.forEach(function (t) {
      if (entry.kw.indexOf(t) !== -1) score += 3;
      if (qTokens.indexOf(t) !== -1) score += 2;
    });
    entry.kw.forEach(function (k) {
      if (k.indexOf(" ") !== -1 && containsPhrase(rawQuery, k)) score += 3;
    });
    return score;
  }

  function bestMatch(rawQuery) {
    var tokens = tokenize(rawQuery);
    if (!tokens.length) return null;
    var best = null, bestScore = 0;
    KB.forEach(function (entry) {
      var s = scoreEntry(rawQuery, tokens, entry);
      if (s > bestScore) { bestScore = s; best = entry; }
    });
    return bestScore >= 2 ? best : null;
  }

  function matchesAny(rawQuery, phrases) {
    var q = " " + rawQuery.toLowerCase() + " ";
    return phrases.some(function (p) { return q.indexOf(p) !== -1; });
  }

  /* ---------------- widget ---------------- */
  var panelOpen = false;
  var everOpened = false;
  var root, panel, thread, input, sendBtn, toggleBtn, typingEl;
  var conversation = []; // {role:"user"|"bot", text} — session-only, sent as context to HANNAH_ENDPOINT
  var HISTORY_LIMIT = 10;
  var hasEscalated = false; // true once this visitor's session has already paged Telegram once

  function remember(role, text) {
    conversation.push({ role: role, text: text });
    if (conversation.length > HISTORY_LIMIT) conversation = conversation.slice(-HISTORY_LIMIT);
  }

  function el(tag, cls, html) {
    var e = document.createElement(tag);
    if (cls) e.className = cls;
    if (html != null) e.innerHTML = html;
    return e;
  }

  function scrollToEnd() {
    thread.scrollTop = thread.scrollHeight;
  }

  function stripHtml(html) {
    return html.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
  }

  function addBotMessage(html, opts) {
    var row = el("div", "hn-row hn-row-bot");
    var avatar = el("div", "hn-avatar", "H");
    var bubble = el("div", "hn-bubble hn-bubble-bot", html);
    row.appendChild(avatar);
    row.appendChild(bubble);
    thread.appendChild(row);
    if (!opts || opts.remember !== false) remember("bot", stripHtml(html));
    if (opts && opts.chips) {
      var chipWrap = el("div", "hn-chips");
      opts.chips.forEach(function (label) {
        var chip = el("button", "hn-chip", label);
        chip.type = "button";
        chip.addEventListener("click", function () { handleSend(label); });
        chipWrap.appendChild(chip);
      });
      thread.appendChild(chipWrap);
    }
    scrollToEnd();
  }

  function addUserMessage(text) {
    var row = el("div", "hn-row hn-row-user");
    var bubble = el("div", "hn-bubble hn-bubble-user");
    bubble.textContent = text;
    row.appendChild(bubble);
    thread.appendChild(row);
    remember("user", text);
    scrollToEnd();
  }

  function showTyping() {
    typingEl = el("div", "hn-row hn-row-bot hn-typing-row");
    var avatar = el("div", "hn-avatar", "H");
    var dots = el("div", "hn-bubble hn-bubble-bot hn-typing", '<span></span><span></span><span></span>');
    typingEl.appendChild(avatar);
    typingEl.appendChild(dots);
    thread.appendChild(typingEl);
    scrollToEnd();
  }

  function hideTyping() {
    if (typingEl && typingEl.parentNode) typingEl.parentNode.removeChild(typingEl);
    typingEl = null;
  }

  var FALLBACK_CHIPS = ["Are cabinets termite-proof?", "How much is the deposit?", "Where are you located?"];

  function fallbackAnswer() {
    addBotMessage(
      "I don't have that one answered yet — I'm a scripted FAQ assistant, not a live salesperson, " +
      "so I only know what's on this site. For anything past that, call or text " +
      '<a href="tel:' + CONTACT.tel + '">' + CONTACT.phone + "</a> or email " +
      '<a href="mailto:' + CONTACT.email + '">' + CONTACT.email + "</a>, or " +
      '<a href="' + enquiryHref() + '" data-hn-enquiry>use the enquiry form</a> to request a site visit.',
      { chips: FALLBACK_CHIPS }
    );
  }

  function enquiryHref() {
    // On a service page this is a real cross-page link — the homepage's own
    // hash-router opens the reading view once that page loads. On the
    // homepage itself the click is intercepted (see the thread listener in
    // buildWidget) and calls window.RitehomeApp.showDoc directly instead,
    // since a bare "#enquiry" jump does nothing while .doc is display:none.
    var isService = document.body.getAttribute("data-hannah-page") === "service";
    return isService ? "../index.html#enquiry" : "#enquiry";
  }

  function respondLocally(rawQuery) {
    if (matchesAny(rawQuery, IDENTITY_WORDS)) {
      addBotMessage("I'm Hannah — an automated FAQ assistant for Ritehome Modular Systems, not a live person. I answer from what's published on this site. For anything I can't answer, our actual team is a call or message away.");
      return;
    }
    if (matchesAny(rawQuery, GREETING_WORDS) && rawQuery.trim().split(/\s+/).length <= 4) {
      addBotMessage("Hi! What would you like to know — kitchens, storage, partitions, workstations, pricing, or something else?", { chips: FALLBACK_CHIPS });
      return;
    }
    if (matchesAny(rawQuery, THANKS_WORDS)) {
      addBotMessage("You're welcome. Anything else you'd like to know?");
      return;
    }
    var match = bestMatch(rawQuery);
    if (match) {
      addBotMessage(match.a);
    } else {
      fallbackAnswer();
    }
  }

  function handleSend(text) {
    text = (text || "").trim();
    if (!text) return;
    var historyForRequest = conversation.slice(); // before this turn's user message
    addUserMessage(text);
    input.value = "";
    sendBtn.disabled = true;
    showTyping();

    if (HANNAH_ENDPOINT) {
      fetch(HANNAH_ENDPOINT, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          message: text,
          history: historyForRequest,
          page: window.location.href,
          already_escalated: hasEscalated // tells the worker whether it already paged Telegram this session
        })
      }).then(function (r) { return r.json(); })
        .then(function (data) {
          hideTyping();
          sendBtn.disabled = false;
          if (data && data.needs_human) hasEscalated = true;
          if (data && data.reply) addBotMessage(data.reply);
          else respondLocally(text);
        }).catch(function () {
          hideTyping();
          sendBtn.disabled = false;
          respondLocally(text);
        });
    } else {
      setTimeout(function () {
        hideTyping();
        sendBtn.disabled = false;
        respondLocally(text);
      }, 380);
    }
  }

  function openPanel() {
    panelOpen = true;
    root.classList.add("hn-open");
    toggleBtn.setAttribute("aria-expanded", "true");
    if (!everOpened) {
      everOpened = true;
      addBotMessage(
        "Hi, I'm <b>Hannah</b> — Ritehome's automated FAQ assistant. Ask me about kitchens, storage, " +
        "partitions, workstations, pricing or termite treatment, and I'll answer from what's on this site.",
        { chips: FALLBACK_CHIPS }
      );
    }
    setTimeout(function () { input.focus(); }, 50);
  }

  function closePanel() {
    panelOpen = false;
    root.classList.remove("hn-open");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.focus();
  }

  function buildWidget() {
    root = el("div", "hn-root");
    root.setAttribute("data-hannah-root", "");

    toggleBtn = el("button", "hn-toggle");
    toggleBtn.type = "button";
    toggleBtn.setAttribute("aria-label", "Chat with Hannah, Ritehome's FAQ assistant");
    toggleBtn.setAttribute("aria-expanded", "false");
    toggleBtn.innerHTML = '<span class="hn-toggle-icon" aria-hidden="true">H</span><span class="hn-toggle-label">Ask Hannah</span>';

    panel = el("div", "hn-panel");
    panel.setAttribute("role", "dialog");
    panel.setAttribute("aria-label", "Chat with Hannah");

    var header = el("div", "hn-header");
    header.innerHTML =
      '<div class="hn-header-id"><span class="hn-header-avatar">H</span>' +
      '<div><span class="hn-header-name">Hannah</span><span class="hn-header-sub">Ritehome FAQ assistant</span></div></div>';
    var closeBtn = el("button", "hn-close", "&times;");
    closeBtn.type = "button";
    closeBtn.setAttribute("aria-label", "Close chat");
    closeBtn.addEventListener("click", closePanel);
    header.appendChild(closeBtn);

    thread = el("div", "hn-thread");
    thread.setAttribute("aria-live", "polite");

    var form = el("form", "hn-form");
    input = el("input", "hn-input");
    input.type = "text";
    input.placeholder = "Ask about kitchens, pricing, termites…";
    input.setAttribute("aria-label", "Message Hannah");
    sendBtn = el("button", "hn-send", "Send");
    sendBtn.type = "submit";
    form.appendChild(input);
    form.appendChild(sendBtn);
    form.addEventListener("submit", function (e) {
      e.preventDefault();
      handleSend(input.value);
    });

    panel.appendChild(header);
    panel.appendChild(thread);
    panel.appendChild(form);

    toggleBtn.addEventListener("click", function () {
      if (panelOpen) closePanel(); else openPanel();
    });

    document.addEventListener("keydown", function (e) {
      if (e.key === "Escape" && panelOpen) closePanel();
    });

    // Answers link to the enquiry form, which lives on the homepage. On a
    // service page that's a real navigation. On the homepage itself the
    // section is display:none until the app's own JS reveals it, so a bare
    // hash jump does nothing — call the app directly when it's on this page.
    thread.addEventListener("click", function (e) {
      var a = e.target.closest && e.target.closest("[data-hn-enquiry]");
      if (!a) return;
      if (window.RitehomeApp && typeof window.RitehomeApp.showDoc === "function") {
        e.preventDefault();
        window.RitehomeApp.showDoc("enquiry");
        closePanel();
      }
    });

    root.appendChild(panel);
    root.appendChild(toggleBtn);
    document.body.appendChild(root);
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", buildWidget);
  } else {
    buildWidget();
  }
})();
