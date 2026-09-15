/* Skeleton-loading lightbox for project galleries.
   Turns every <a target="_blank"> that wraps a gallery <img> into a
   same-page popup with prev/next navigation, instead of opening a tab. */
(function(){
  "use strict";

  var IMG_HREF = /\.(jpe?g|png|webp)$/i;

  function collectGroups(){
    var groups = new Map();
    var links = document.querySelectorAll('a[target="_blank"]');
    links.forEach(function(link){
      var img = link.querySelector("img");
      if(!img || !IMG_HREF.test(link.getAttribute("href") || "")) return;
      var parent = link.parentElement;
      if(!groups.has(parent)) groups.set(parent, []);
      groups.get(parent).push(link);
    });
    return groups;
  }

  function buildOverlay(){
    var overlay = document.createElement("div");
    overlay.className = "lb-overlay";
    overlay.setAttribute("role","dialog");
    overlay.setAttribute("aria-modal","true");
    overlay.setAttribute("aria-label","Photo viewer");
    overlay.hidden = true;
    overlay.innerHTML =
      '<button type="button" class="lb-close" aria-label="Close">&times;</button>' +
      '<button type="button" class="lb-nav lb-prev" aria-label="Previous photo">&larr;</button>' +
      '<div class="lb-stage">' +
        '<div class="lb-skeleton"></div>' +
        '<img class="lb-img" alt="">' +
        '<p class="lb-cap"></p>' +
      '</div>' +
      '<button type="button" class="lb-nav lb-next" aria-label="Next photo">&rarr;</button>' +
      '<div class="lb-counter"></div>';
    document.body.appendChild(overlay);
    return overlay;
  }

  function initLightbox(){
    var groups = collectGroups();
    if(groups.size === 0) return;

    var overlay = buildOverlay();
    var skeleton = overlay.querySelector(".lb-skeleton");
    var imgEl = overlay.querySelector(".lb-img");
    var capEl = overlay.querySelector(".lb-cap");
    var counterEl = overlay.querySelector(".lb-counter");
    var prevBtn = overlay.querySelector(".lb-prev");
    var nextBtn = overlay.querySelector(".lb-next");
    var closeBtn = overlay.querySelector(".lb-close");

    var activeItems = [];
    var activeIndex = 0;
    var lastFocused = null;

    function render(){
      var link = activeItems[activeIndex];
      var img = link.querySelector("img");
      var cap = link.querySelector(".cap");

      imgEl.classList.remove("is-loaded");
      skeleton.hidden = false;

      imgEl.alt = img ? (img.getAttribute("alt") || "") : "";
      capEl.innerHTML = cap ? cap.innerHTML : "";
      counterEl.textContent = activeItems.length > 1 ?
        (activeIndex + 1) + " / " + activeItems.length : "";

      var multi = activeItems.length > 1;
      prevBtn.hidden = !multi;
      nextBtn.hidden = !multi;

      var onReady = function(){
        imgEl.classList.add("is-loaded");
        skeleton.hidden = true;
      };
      imgEl.onload = onReady;
      imgEl.src = link.getAttribute("href");
      if(imgEl.complete && imgEl.naturalWidth > 0) onReady();
    }

    function open(items, index, trigger){
      activeItems = items;
      activeIndex = index;
      lastFocused = trigger || document.activeElement;
      render();
      overlay.hidden = false;
      requestAnimationFrame(function(){
        overlay.classList.add("is-open");
      });
      document.body.classList.add("lb-locked");
      closeBtn.focus();
    }

    function close(){
      overlay.classList.remove("is-open");
      document.body.classList.remove("lb-locked");
      window.setTimeout(function(){ overlay.hidden = true; }, 220);
      if(lastFocused && typeof lastFocused.focus === "function") lastFocused.focus();
    }

    function step(delta){
      if(activeItems.length < 2) return;
      activeIndex = (activeIndex + delta + activeItems.length) % activeItems.length;
      render();
    }

    groups.forEach(function(links){
      links.forEach(function(link, i){
        link.addEventListener("click", function(e){
          e.preventDefault();
          open(links, i, link);
        });
      });
    });

    closeBtn.addEventListener("click", close);
    prevBtn.addEventListener("click", function(){ step(-1); });
    nextBtn.addEventListener("click", function(){ step(1); });
    overlay.addEventListener("click", function(e){
      if(e.target === overlay) close();
    });
    document.addEventListener("keydown", function(e){
      if(overlay.hidden) return;
      if(e.key === "Escape") close();
      else if(e.key === "ArrowLeft") step(-1);
      else if(e.key === "ArrowRight") step(1);
    });
  }

  if(document.readyState === "loading"){
    document.addEventListener("DOMContentLoaded", initLightbox);
  } else {
    initLightbox();
  }
})();
