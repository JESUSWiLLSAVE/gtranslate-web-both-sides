// ==UserScript==
// @name         Google Translate — Type in Both Sides
// @namespace    https://github.com/JESUSWiLLSAVE
// @version      2.3.0
// @description  Type into both fields on translate.google.com. Edits on the result side are translated back into the source language without swapping the selected languages.
// @author       JESUSWiLLSAVE
// @match        https://translate.google.com/*
// @grant        GM.xmlHttpRequest
// @connect      translate.googleapis.com
// @run-at       document-idle
// @license      MIT
// ==/UserScript==

/*
 * Makes the translation-result field editable.
 * - Left (source) field: already editable, works normally.
 * - Right (result) field: Google's result node is hidden and replaced by our
 *   own contenteditable overlay.
 *
 * Authority model:
 * - After you edit the overlay, YOUR text is authoritative and is never
 *   overwritten by Google's re-renders — no matter how long ago the edit was.
 * - Editing the left (source) field hands authority back to Google: the next
 *   translation it renders is copied into the overlay.
 */
(() => {
  "use strict";

  const REVERSE_DEBOUNCE_MS = 700;
  const SWAP_SETTLE_TIMEOUT_MS = 2500;
  const SWAP_POLL_INTERVAL_MS = 60;

  const SOURCE_SELECTORS = [
    'textarea[aria-label="Source text"]',
    "textarea#source",
    "textarea.EIhZRe",
    "form textarea",
    "textarea",
  ];

  const SWAP_SELECTORS = [
    'button[aria-label="Swap languages"]',
    'button[aria-label*="Swap"]',
    'button[jsname="jl3qub"]',
  ];

  const GTX_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

  let overlay = null;
  let hiddenLeaf = null;
  let mirrorMode = "google";
  let lastTranslation = "";
  let lastSeenGoogleText = "";
  let lastUserText = null;
  let reverseTimer = null;
  let reversing = false;
  let pendingReverse = false;
  let pristineValueSetter;

  const getPristineValueSetter = () => {
    if (pristineValueSetter !== undefined) return pristineValueSetter;
    try {
      const iframe = document.createElement("iframe");
      iframe.style.display = "none";
      document.documentElement.appendChild(iframe);
      pristineValueSetter =
        Object.getOwnPropertyDescriptor(
          iframe.contentWindow.HTMLTextAreaElement.prototype,
          "value"
        )?.set || null;
      iframe.remove();
    } catch (error) {
      pristineValueSetter = null;
    }
    if (!pristineValueSetter) {
      pristineValueSetter =
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")
          ?.set || null;
    }
    return pristineValueSetter;
  };

  const injectStyle = () => {
    if (document.getElementById("gtbs-style")) return;
    const style = document.createElement("style");
    style.id = "gtbs-style";
    style.textContent = `
      [data-gtbs-editable="true"] {
        cursor: text;
      }
      [data-gtbs-editable="true"]:focus {
        outline: 2px solid #8ab4f8;
        outline-offset: 2px;
        border-radius: 4px;
      }
    `;
    document.head.appendChild(style);
  };

  const findSource = () => {
    for (const sel of SOURCE_SELECTORS) {
      for (const el of document.querySelectorAll(sel)) {
        if (el instanceof HTMLTextAreaElement && el.offsetParent !== null) return el;
      }
    }
    return null;
  };

  const attachSourceGuard = () => {
    const source = findSource();
    if (!source || source.dataset.gtbsGuard === "true") return;
    source.dataset.gtbsGuard = "true";
    source.addEventListener("input", (event) => {
      if (!event.isTrusted) return;
      mirrorMode = "google";
      lastUserText = null;
    });
  };

  const findSwapButton = () => {
    for (const sel of SWAP_SELECTORS) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLButtonElement && !el.disabled) return el;
    }
    return null;
  };

  const isOurNode = (el) =>
    (overlay !== null && (el === overlay || overlay.contains(el))) ||
    (hiddenLeaf !== null && (el === hiddenLeaf || hiddenLeaf.contains(el)));

  const isEditableTextLeaf = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (!text) return false;
    return el.children.length === 0 || el.tagName === "SPAN";
  };

  const isVisible = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const rect = el.getBoundingClientRect();
    if (rect.width === 0 || rect.height === 0) return false;
    const style = window.getComputedStyle(el);
    return style.visibility !== "hidden" && style.display !== "none";
  };

  const notOurs = (el) =>
    !isOurNode(el) && !(hiddenLeaf !== null && el === hiddenLeaf);

  const findVisibleLeaf = () => {
    const primaries = Array.from(document.querySelectorAll("span.ryNqvb")).filter(
      notOurs
    );
    if (primaries.length > 0) {
      return primaries.find((el) => isVisible(el) && isEditableTextLeaf(el)) || null;
    }
    for (const sel of ['div[jsname="W297wb"]', 'div[aria-live="polite"]:not([role="status"])']) {
      const els = Array.from(document.querySelectorAll(sel)).filter(notOurs);
      if (els.length === 0) continue;
      const container = els.find((el) => isVisible(el));
      if (!container) return null;
      if (isEditableTextLeaf(container)) return container;
      const leaves = Array.from(container.querySelectorAll("span, div")).filter(
        (n) =>
          notOurs(n) &&
          isVisible(n) &&
          isEditableTextLeaf(n) &&
          !n.closest('[role="status"]')
      );
      if (leaves.length > 0) return leaves[leaves.length - 1];
      return container;
    }
    return null;
  };

  const userIsEditingResult = () => {
    return (
      overlay !== null &&
      overlay.isConnected &&
      (document.activeElement === overlay ||
        overlay.contains(document.activeElement))
    );
  };

  const onResultInput = (event) => {
    if (!event.isTrusted) return;
    if (!userIsEditingResult()) return;
    mirrorMode = "user";
    lastUserText = (overlay.textContent || "").trim();
    scheduleReverse();
  };

  const onResultKeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      fireReverse();
    }
  };

  const setSourceValue = (textarea, value, silent = false) => {
    const setter = getPristineValueSetter();
    if (setter) {
      setter.call(textarea, value);
    } else {
      textarea.value = value;
    }
    if (silent) return;
    textarea.dispatchEvent(new Event("input", { bubbles: true }));
    textarea.dispatchEvent(new Event("change", { bubbles: true }));
  };

  const poll = (predicate, timeout) =>
    new Promise((resolve) => {
      const started = Date.now();
      const timer = window.setInterval(() => {
        if (predicate()) {
          window.clearInterval(timer);
          resolve(true);
        } else if (Date.now() - started > timeout) {
          window.clearInterval(timer);
          resolve(false);
        }
      }, SWAP_POLL_INTERVAL_MS);
    });

  const getUrlLangs = () => {
    const params = new URLSearchParams(window.location.search);
    return { sl: params.get("sl"), tl: params.get("tl") };
  };

  const gtxUrl = (text, sl, tl) =>
    `${GTX_ENDPOINT}?client=gtx&dt=t` +
    `&sl=${encodeURIComponent(sl)}&tl=${encodeURIComponent(tl)}` +
    `&q=${encodeURIComponent(text)}`;

  const parseGtx = (data) => {
    if (!Array.isArray(data) || !Array.isArray(data[0])) {
      throw new Error("unexpected gtx payload");
    }
    const parts = data[0]
      .filter(Array.isArray)
      .map((segment) => (typeof segment[0] === "string" ? segment[0] : ""))
      .filter((part) => part.length > 0);
    return {
      text: parts.join(""),
      detected: typeof data[2] === "string" ? data[2] : null,
    };
  };

  const gmxhrJson = (url) =>
    new Promise((resolve, reject) => {
      if (typeof GM === "undefined" || !GM.xmlHttpRequest) {
        reject(new Error("GM.xmlHttpRequest unavailable"));
        return;
      }
      GM.xmlHttpRequest({
        method: "GET",
        url,
        onload: (response) => {
          if (response.status >= 200 && response.status < 300) {
            try {
              resolve(JSON.parse(response.responseText));
            } catch (error) {
              reject(error);
            }
          } else {
            reject(new Error(`gtx ${response.status}`));
          }
        },
        onerror: () => reject(new Error("gtx network error")),
      });
    });

  const gtxTranslate = async (text, sl, tl) => {
    const url = gtxUrl(text, sl, tl);
    let data;
    try {
      data = await gmxhrJson(url);
    } catch (error) {
      const response = await fetch(url);
      if (!response.ok) throw new Error(`gtx ${response.status}`);
      data = await response.json();
    }
    return parseGtx(data);
  };

  const swapAndTranslate = async (edited, source) => {
    const previousTranslation = lastTranslation;
    const swap = findSwapButton();
    if (swap && previousTranslation) {
      swap.click();
      await poll(
        () =>
          source.value.trim() === previousTranslation ||
          source.value.trim() === "",
        SWAP_SETTLE_TIMEOUT_MS
      );
    }
    setSourceValue(source, edited);
  };

  const reverseTranslate = async () => {
    if (!overlay || !overlay.isConnected) return;
    if (reversing) {
      pendingReverse = true;
      return;
    }

    const edited = (overlay.textContent || "").trim();
    const source = findSource();
    if (!source) return;

    if (edited === lastTranslation) return;
    reversing = true;

    try {
      if (edited === "") {
        setSourceValue(source, "", true);
        lastTranslation = "";
        return;
      }
      const { sl, tl } = getUrlLangs();
      if (tl) {
        let sourceLang = sl && sl !== "auto" ? sl : null;
        if (!sourceLang && source.value.trim()) {
          try {
            const probe = await gtxTranslate(source.value.trim(), "auto", "en");
            sourceLang = probe.detected;
          } catch (error) {
            sourceLang = null;
          }
        }
        if (sourceLang) {
          const back = await gtxTranslate(edited, tl, sourceLang);
          if (typeof back.text !== "string" || !back.text.trim()) {
            throw new Error("empty back-translation");
          }
          setSourceValue(source, back.text, true);
          lastTranslation = edited;
          return;
        }
      }
      await swapAndTranslate(edited, source);
    } catch (error) {
      setSourceValue(source, edited);
    } finally {
      reversing = false;
    }
  };

  const scheduleReverse = () => {
    window.clearTimeout(reverseTimer);
    reverseTimer = window.setTimeout(fireReverse, REVERSE_DEBOUNCE_MS);
  };

  const fireReverse = async () => {
    await reverseTranslate();
    if (pendingReverse && !reversing) {
      pendingReverse = false;
      await reverseTranslate();
    }
  };

  const syncFromGoogle = () => {
    if (!hiddenLeaf || !hiddenLeaf.isConnected) return;
    const googleText = (hiddenLeaf.textContent || "").trim();
    if (googleText === lastSeenGoogleText) return;
    lastSeenGoogleText = googleText;
    if (mirrorMode !== "google") return;
    if (userIsEditingResult()) return;
    overlay.textContent = hiddenLeaf.textContent;
    lastTranslation = googleText;
  };

  const hideStrays = () => {
    for (const el of document.querySelectorAll("span.ryNqvb")) {
      if (isOurNode(el)) continue;
      const text = (el.textContent || "").trim();
      if (!text) continue;
      if (el !== hiddenLeaf && text !== lastSeenGoogleText) {
        hiddenLeaf = el;
        lastSeenGoogleText = text;
        if (mirrorMode === "google" && !userIsEditingResult()) {
          overlay.textContent = el.textContent;
          lastTranslation = text;
        }
      }
      if (el.style.display !== "none") el.style.display = "none";
    }
  };

  const seedOverlay = (leaf) => {
    const googleText = (leaf.textContent || "").trim();
    lastSeenGoogleText = googleText;
    hiddenLeaf = leaf;
    if (mirrorMode === "user" && lastUserText !== null) {
      overlay.textContent = lastUserText;
      lastTranslation = lastUserText;
    } else {
      overlay.textContent = leaf.textContent;
      lastTranslation = googleText;
      lastUserText = null;
    }
  };

  const hideAndAttach = (leaf) => {
    const container = leaf.parentElement;
    if (!container) return;

    if (!overlay || !overlay.isConnected) {
      overlay = document.createElement("div");
      overlay.contentEditable = "true";
      overlay.setAttribute("data-gtbs-editable", "true");
      overlay.spellcheck = false;
      overlay.style.whiteSpace = "pre-wrap";
      overlay.style.minHeight = "1em";
      overlay.addEventListener("input", onResultInput);
      overlay.addEventListener("keydown", onResultKeydown);
    }

    leaf.style.display = "none";
    container.insertBefore(overlay, leaf);
    seedOverlay(leaf);
  };

  const ensureOverlay = () => {
    const source = findSource();
    if (
      source &&
      mirrorMode === "user" &&
      source.value.trim() === "" &&
      overlay &&
      (overlay.textContent || "").trim() !== ""
    ) {
      mirrorMode = "google";
    }

    if (overlay && overlay.isConnected && hiddenLeaf && hiddenLeaf.isConnected) {
      syncFromGoogle();
      hideStrays();
      return;
    }
    const leaf = findVisibleLeaf();
    if (!leaf) return;
    hideAndAttach(leaf);
    hideStrays();
  };

  let rescanScheduled = false;
  const scheduleRescan = () => {
    if (rescanScheduled) return;
    rescanScheduled = true;
    window.setTimeout(() => {
      rescanScheduled = false;
      injectStyle();
      attachSourceGuard();
      ensureOverlay();
    }, 150);
  };

  injectStyle();
  attachSourceGuard();
  ensureOverlay();

  const observer = new MutationObserver((mutations) => {
    for (const mutation of mutations) {
      if (mutation.type === "childList" && mutation.addedNodes.length > 0) {
        scheduleRescan();
        return;
      }
    }
  });
  observer.observe(document.body, { childList: true, subtree: true });
})();
