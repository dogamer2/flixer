(function () {
  var TV_MODE_KEY = "flixer_tv_mode";
  var ACTIVE_CLASS = "tv-focused";
  var CARD_CLASS = "tv-card";
  var ROW_SELECTOR = "[data-row-id]";
  var mutationTimer = null;
  var lastFocused = null;
  var rowCounter = 0;
  var queuedFocusScroll = null;
  var focusRecoveryTimer = null;

  function isTvMode() {
    try {
      if (localStorage.getItem(TV_MODE_KEY) === "1") return true;
    } catch (error) {}

    try {
      var params = new URLSearchParams(window.location.search);
      if (params.get("tv") === "1") return true;
    } catch (error) {}

    var ua = navigator.userAgent || "";
    return /GoogleTV|Android TV|SMART-TV|AFT|BRAVIA|TV\b/i.test(ua);
  }

  if (!isTvMode()) return;

  document.documentElement.classList.add("tv-mode");
  try {
    sessionStorage.setItem("backupBannerDismissed", "true");
  } catch (error) {}

  function isVisible(el) {
    if (!el || !el.isConnected) return false;
    var style = window.getComputedStyle(el);
    if (style.display === "none" || style.visibility === "hidden") return false;
    var rect = el.getBoundingClientRect();
    return rect.width > 16 && rect.height > 16;
  }

  function isNaturallyFocusable(el) {
    return /^(A|BUTTON|INPUT|TEXTAREA|SELECT)$/.test(el.tagName);
  }

  function isTextInput(el) {
    return !!el && (
      el.tagName === "TEXTAREA" ||
      (el.tagName === "INPUT" && !/^(button|checkbox|color|file|hidden|image|radio|range|reset|submit)$/i.test(el.type || "text")) ||
      el.isContentEditable
    );
  }

  function markFocusable(el, options) {
    if (!el || el.dataset.tvFocusable === "1" || !isVisible(el)) return;

    el.dataset.tvFocusable = "1";
    if (options && options.card) {
      el.classList.add(CARD_CLASS);
      el.dataset.tvCard = "1";
    }

    if (!isNaturallyFocusable(el) && el.tabIndex < 0) {
      el.tabIndex = 0;
    }
  }

  function candidateScore(fromRect, toRect, direction) {
    var fromX = fromRect.left + fromRect.width / 2;
    var fromY = fromRect.top + fromRect.height / 2;
    var toX = toRect.left + toRect.width / 2;
    var toY = toRect.top + toRect.height / 2;
    var dx = toX - fromX;
    var dy = toY - fromY;

    if (direction === "left" && dx >= -8) return Infinity;
    if (direction === "right" && dx <= 8) return Infinity;
    if (direction === "up" && dy >= -8) return Infinity;
    if (direction === "down" && dy <= 8) return Infinity;

    var primary = direction === "left" || direction === "right" ? Math.abs(dx) : Math.abs(dy);
    var secondary = direction === "left" || direction === "right" ? Math.abs(dy) : Math.abs(dx);
    return primary + secondary * 3;
  }

  function focusables() {
    return Array.from(document.querySelectorAll("[data-tv-focusable='1']")).filter(isVisible);
  }

  function overlayContainers() {
    return Array.from(document.querySelectorAll(".fixed, [role='dialog'], [aria-modal='true'], .absolute"))
      .filter(isVisible)
      .sort(function (a, b) {
        return b.getBoundingClientRect().width * b.getBoundingClientRect().height -
          a.getBoundingClientRect().width * a.getBoundingClientRect().height;
      });
  }

  function preferredFocusable() {
    var overlays = overlayContainers();
    for (var i = 0; i < overlays.length; i += 1) {
      var candidates = Array.from(overlays[i].querySelectorAll("[data-tv-focusable='1']")).filter(isVisible);
      if (candidates.length) {
        var strongMatch = candidates.find(function (el) {
          var label = ((el.getAttribute("aria-label") || "") + " " + (el.textContent || "")).toLowerCase();
          return /play|continue|more info|overview|episodes|close|back/.test(label);
        });
        return strongMatch || candidates[0];
      }
    }

    if (lastFocused && isVisible(lastFocused) && lastFocused.dataset.tvFocusable === "1") {
      return lastFocused;
    }

    var items = focusables();
    return items[0] || null;
  }

  function recoverFocus() {
    var active = getFocusableTarget(document.activeElement);
    if (active && isVisible(active)) return false;

    var target = preferredFocusable();
    if (!target) return false;

    if (target.dataset.tvCard === "1") {
      return focusCard(target);
    }

    target.focus({ preventScroll: true });
    target.scrollIntoView({ block: "nearest", inline: "nearest", behavior: "smooth" });
    return true;
  }

  function scheduleFocusRecovery(delay) {
    window.clearTimeout(focusRecoveryTimer);
    focusRecoveryTimer = window.setTimeout(function () {
      recoverFocus();
    }, delay || 0);
  }

  function isSelectKey(event) {
    var key = event.key;
    var code = event.code;
    var keyCode = Number(event.keyCode || event.which || 0);
    return key === "Enter" ||
      key === " " ||
      key === "Spacebar" ||
      key === "Center" ||
      key === "Select" ||
      key === "OK" ||
      key === "DPadCenter" ||
      code === "Enter" ||
      code === "NumpadEnter" ||
      keyCode === 13 ||
      keyCode === 23 ||
      keyCode === 66 ||
      keyCode === 160;
  }

  function getFocusableTarget(el) {
    return el && el.closest("[data-tv-focusable='1']");
  }

  function getRowCards(rowId) {
    return focusables()
      .filter(function (el) {
        return el.dataset.tvRowId === rowId && el.dataset.tvCard === "1";
      })
      .sort(function (a, b) {
        return Number(a.dataset.tvRowIndex || "0") - Number(b.dataset.tvRowIndex || "0");
      });
  }

  function getRowContainer(rowId) {
    return document.querySelector(ROW_SELECTOR + '[data-tv-row-id="' + rowId + '"]');
  }

  function rowCenterY(rowId) {
    var row = getRowContainer(rowId);
    if (!row) return null;
    var rect = row.getBoundingClientRect();
    return rect.top + rect.height / 2;
  }

  function cardCenterX(card) {
    var rect = card.getBoundingClientRect();
    return rect.left + rect.width / 2;
  }

  function getCurrentRowTarget() {
    var active = getFocusableTarget(document.activeElement);
    if (!active || !active.dataset.tvRowId) return null;
    return active;
  }

  function canScrollRow(row, direction) {
    if (!row) return false;
    if (direction === "right") {
      return row.scrollLeft + row.clientWidth < row.scrollWidth - 8;
    }
    return row.scrollLeft > 8;
  }

  function scrollRowToCard(row, card) {
    if (!row || !card) return;
    var rowRect = row.getBoundingClientRect();
    var cardRect = card.getBoundingClientRect();
    var maxScroll = Math.max(0, row.scrollWidth - row.clientWidth);
    var desired = row.scrollLeft + (cardRect.left - rowRect.left) - (rowRect.width - cardRect.width) / 2;
    desired = Math.max(0, Math.min(maxScroll, desired));
    row.scrollTo({ left: desired, behavior: "smooth" });
  }

  function centerElementVertically(el) {
    if (!el) return;
    var rect = el.getBoundingClientRect();
    var viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    var desiredTop = window.scrollY + rect.top - (viewportHeight - rect.height) / 2;
    var maxScroll = Math.max(0, document.documentElement.scrollHeight - viewportHeight);
    desiredTop = Math.max(0, Math.min(maxScroll, desiredTop));
    window.scrollTo({ top: desiredTop, behavior: "smooth" });
  }

  function centerCardInViewport(card, options) {
    if (!card) return;

    var row = card.dataset.tvRowId ? getRowContainer(card.dataset.tvRowId) : null;
    var verticalTarget = row || card;
    var skipHorizontal = !!(options && options.skipHorizontal);

    if (row && !skipHorizontal) {
      scrollRowToCard(row, card);
    }

    centerElementVertically(verticalTarget);
  }

  function queueFocusScroll(target, options) {
    if (!target) return;
    queuedFocusScroll = {
      target: target,
      options: options || {},
      expiresAt: Date.now() + 450
    };
  }

  function focusCard(target, options) {
    if (!target) return false;
    queueFocusScroll(target, options);
    target.focus({ preventScroll: true });
    return true;
  }

  function revealMoreRow(rowId, direction, fallbackIndex) {
    var row = getRowContainer(rowId);
    if (!canScrollRow(row, direction)) return false;

    var amount = Math.max(220, Math.floor(row.clientWidth * 0.65));
    var maxScroll = Math.max(0, row.scrollWidth - row.clientWidth);
    var desired = row.scrollLeft + (direction === "right" ? amount : -amount);
    desired = Math.max(0, Math.min(maxScroll, desired));
    row.scrollTo({ left: desired, behavior: "smooth" });

    window.setTimeout(function () {
      assignFocusables();
      var cards = getRowCards(rowId);
      if (!cards.length) return;
      var safeIndex = Math.max(0, Math.min(cards.length - 1, fallbackIndex));
      var target = cards[safeIndex];
      if (target) {
        focusCard(target, { skipHorizontal: true });
      }
    }, 260);

    return true;
  }

  function moveBetweenRows(direction) {
    var current = getCurrentRowTarget();
    if (!current) return false;

    var currentRowId = current.dataset.tvRowId;
    var currentRowY = rowCenterY(currentRowId);
    if (currentRowY == null) return false;

    var rowIds = Array.from(new Set(
      focusables()
        .filter(function (el) { return el.dataset.tvCard === "1" && el.dataset.tvRowId; })
        .map(function (el) { return el.dataset.tvRowId; })
    )).sort(function (a, b) {
      return rowCenterY(a) - rowCenterY(b);
    });

    var currentRowIndex = rowIds.indexOf(currentRowId);
    if (currentRowIndex === -1) return false;

    var targetRowIndex = direction === "down" ? currentRowIndex + 1 : currentRowIndex - 1;
    if (targetRowIndex < 0 || targetRowIndex >= rowIds.length) return false;

    var targetRowId = rowIds[targetRowIndex];
    var targetCards = getRowCards(targetRowId);
    if (!targetCards.length) return false;

    var currentX = cardCenterX(current);
    var best = null;
    var bestDistance = Infinity;

    targetCards.forEach(function (card) {
      var distance = Math.abs(cardCenterX(card) - currentX);
      if (distance < bestDistance) {
        best = card;
        bestDistance = distance;
      }
    });

    if (!best) return false;

    focusCard(best);
    return true;
  }

  function applyFocusState(target) {
    if (lastFocused && lastFocused !== target) {
      lastFocused.classList.remove(ACTIVE_CLASS);
    }
    if (target) {
      target.classList.add(ACTIVE_CLASS);
      lastFocused = target;
    }
  }

  function nearestFocusable(direction) {
    var current = getFocusableTarget(document.activeElement);
    var items = focusables();
    if (!items.length) return null;
    if (!current || current === document.body) return items[0];

    var currentRect = current.getBoundingClientRect();
    var best = null;
    var bestScore = Infinity;

    items.forEach(function (candidate) {
      if (candidate === current) return;
      var score = candidateScore(currentRect, candidate.getBoundingClientRect(), direction);
      if (score < bestScore) {
        best = candidate;
        bestScore = score;
      }
    });

    return best;
  }

  function moveWithinRow(direction) {
    var current = getCurrentRowTarget();
    if (!current) return false;

    var rowId = current.dataset.tvRowId;
    var cards = getRowCards(rowId);
    if (!cards.length) return false;

    var currentIndex = cards.indexOf(current);
    if (currentIndex === -1) return false;

    var nextIndex = direction === "left" ? currentIndex - 1 : currentIndex + 1;
    if (nextIndex < 0 || nextIndex >= cards.length) {
      return revealMoreRow(
        rowId,
        direction,
        direction === "right" ? cards.length - 1 : 0
      );
    }

    var target = cards[nextIndex];
    return focusCard(target);
  }

  function moveFocus(direction) {
    if ((direction === "left" || direction === "right") && moveWithinRow(direction)) {
      return true;
    }

    if ((direction === "up" || direction === "down") && moveBetweenRows(direction)) {
      return true;
    }

    var target = nearestFocusable(direction);
    if (!target) return false;
    if (target.dataset.tvCard === "1") {
      return focusCard(target);
    } else {
      target.focus({ preventScroll: true });
      target.scrollIntoView({ block: "center", inline: "nearest", behavior: "smooth" });
    }
    return true;
  }

  function visibleMoreInfoButton() {
    var candidates = Array.from(document.querySelectorAll('button[aria-label="More Info"],button[aria-label="more info"],button[aria-label="More info"]'));
    for (var i = 0; i < candidates.length; i += 1) {
      if (isVisible(candidates[i])) return candidates[i];
    }
    return null;
  }

  function getReactProps(node) {
    if (!node) return null;
    var keys = Object.keys(node);
    for (var i = 0; i < keys.length; i += 1) {
      if (keys[i].indexOf("__reactProps$") === 0) {
        return node[keys[i]];
      }
    }
    return null;
  }

  function invokeReactHandler(target, handlerName) {
    var props = getReactProps(target);
    if (!props || typeof props[handlerName] !== "function") return false;

    props[handlerName]({
      currentTarget: target,
      target: target,
      preventDefault: function () {},
      stopPropagation: function () {},
      nativeEvent: {}
    });
    return true;
  }

  function openFocusedCardDetails(target) {
    if (!target || target.dataset.tvCard !== "1") return false;

    invokeReactHandler(target, "onMouseEnter");
    invokeReactHandler(target, "onMouseMove");
    target.dispatchEvent(new MouseEvent("mouseover", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mouseenter", { bubbles: true, cancelable: true, view: window }));
    target.dispatchEvent(new MouseEvent("mousemove", { bubbles: true, cancelable: true, view: window }));

    window.setTimeout(function () {
      var button = visibleMoreInfoButton();
      if (button) {
        button.click();
      } else if (typeof target.click === "function") {
        target.click();
      }
    }, 560);

    return true;
  }

  function assignFocusables() {
    Array.from(document.querySelectorAll('a[href*="backup-domains"], a[href*="feedback"], button[aria-label="Backup Domains"]')).forEach(function (el) {
      el.style.display = "none";
      el.setAttribute("aria-hidden", "true");
      el.tabIndex = -1;
    });

    Array.from(document.querySelectorAll("header a, header button, nav a, nav button, input, textarea, select, [role='button']")).forEach(function (el) {
      markFocusable(el, { card: false });
    });

    Array.from(document.querySelectorAll(ROW_SELECTOR)).forEach(function (row) {
      if (!row.dataset.tvRowId) {
        rowCounter += 1;
        row.dataset.tvRowId = "row-" + rowCounter;
      }

      Array.from(row.querySelectorAll(":scope > div > *")).forEach(function (card, index) {
        markFocusable(card, { card: true });
        card.dataset.tvRowId = row.dataset.tvRowId;
        card.dataset.tvRowIndex = String(index);
      });
    });

    Array.from(document.querySelectorAll("div.grid > div, div.grid > a, div.grid > button")).forEach(function (item) {
      if (item.querySelector("img")) {
        markFocusable(item, { card: true });
      }
    });

    Array.from(document.querySelectorAll(".fixed button, .fixed a, .fixed input, .fixed textarea, .absolute button, .absolute a")).forEach(function (el) {
      if (el.getAttribute("aria-label") === "Scroll left" || el.getAttribute("aria-label") === "Scroll right") {
        return;
      }
      markFocusable(el, { card: false });
    });

    recoverFocus();
  }

  function scheduleAssign() {
    window.clearTimeout(mutationTimer);
    mutationTimer = window.setTimeout(function () {
      assignFocusables();
      scheduleFocusRecovery(30);
    }, 60);
  }

  document.addEventListener("focusin", function (event) {
    var target = event.target && event.target.closest("[data-tv-focusable='1']");
    if (!target) return;
    applyFocusState(target);

    window.setTimeout(function () {
      if (target.dataset.tvCard === "1") {
        if (queuedFocusScroll && queuedFocusScroll.target === target && queuedFocusScroll.expiresAt >= Date.now()) {
          centerCardInViewport(target, queuedFocusScroll.options);
          queuedFocusScroll = null;
          return;
        }
        centerCardInViewport(target);
        return;
      }

      if (isTextInput(target)) {
        target.scrollIntoView({
          block: "center",
          inline: "nearest",
          behavior: "smooth"
        });
        return;
      }

      target.scrollIntoView({
        block: "nearest",
        inline: "nearest",
        behavior: "smooth"
      });
    }, isTextInput(target) ? 120 : 0);
  }, true);

  document.addEventListener("focusout", function (event) {
    var target = event.target && event.target.closest("[data-tv-focusable='1']");
    if (target) target.classList.remove(ACTIVE_CLASS);
    scheduleFocusRecovery(80);
  }, true);

    document.addEventListener("keydown", function (event) {
    var active = document.activeElement;
    var key = event.key;

    if (isTextInput(active)) {
      if (key === "Enter") {
        var form = active.form;
        if (form && typeof form.requestSubmit === "function") {
          form.requestSubmit();
        } else if (form) {
          form.submit();
        }
        window.setTimeout(function () {
          active.blur();
        }, 30);
      }
      return;
    }

    if (key === "ArrowLeft" || key === "ArrowRight" || key === "ArrowUp" || key === "ArrowDown") {
      event.preventDefault();
      moveFocus(key.replace("Arrow", "").toLowerCase());
      return;
    }

    if (isSelectKey(event) && active && active.dataset.tvFocusable === "1") {
      event.preventDefault();
      if (!openFocusedCardDetails(active) && typeof active.click === "function") {
        active.click();
      }
    }
  }, true);

  var observer = new MutationObserver(scheduleAssign);
  observer.observe(document.documentElement, { childList: true, subtree: true });

  document.addEventListener("visibilitychange", function () {
    if (!document.hidden) {
      scheduleFocusRecovery(30);
    }
  });

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", assignFocusables);
  } else {
    assignFocusables();
    scheduleFocusRecovery(30);
  }
})();
