// ==UserScript==
// @name         Google Translate — Type in Both Sides
// @namespace    https://github.com/JESUSWiLLSAVE
// @version      2.1.0
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
 * - Right (result) field: made contenteditable. When you edit it, the
 *   script translates your edited text back into the source language via
 *   Google's translate endpoint and updates the left field — the selected
 *   languages never swap sides.
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

  const RESULT_SELECTORS = [
    "span.ryNqvb",
    'div[jsname="W297wb"]',
    'div[aria-live="polite"]',
  ];

  const SWAP_SELECTORS = [
    'button[aria-label="Swap languages"]',
    'button[aria-label*="Swap"]',
    'button[jsname="jl3qub"]',
  ];

  const GTX_ENDPOINT = "https://translate.googleapis.com/translate_a/single";

  let resultTarget = null;
  let lastTranslation = "";
  let lastUserText = null;
  let reverseTimer = null;
  let reversing = false;
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

  const findSwapButton = () => {
    for (const sel of SWAP_SELECTORS) {
      const el = document.querySelector(sel);
      if (el instanceof HTMLButtonElement && !el.disabled) return el;
    }
    return null;
  };

  const isEditableTextLeaf = (el) => {
    if (!(el instanceof HTMLElement)) return false;
    const text = (el.textContent || "").trim();
    if (!text) return false;
    return el.children.length === 0 || el.tagName === "SPAN";
  };

  const findResultTarget = () => {
    for (const sel of RESULT_SELECTORS) {
      const el = document.querySelector(sel);
      if (!el || el.offsetParent === null) continue;
      if (isEditableTextLeaf(el)) return el;
      const leaves = Array.from(el.querySelectorAll("span, div")).filter(
        (n) => n.offsetParent !== null && isEditableTextLeaf(n)
      );
      if (leaves.length > 0) return leaves[leaves.length - 1];
      return el;
    }
    return null;
  };

  const placeCaretEnd = (el) => {
    const selection = window.getSelection();
    const range = document.createRange();
    range.selectNodeContents(el);
    range.collapse(false);
    selection.removeAllRanges();
    selection.addRange(range);
  };

  const restoreUserText = (target) => {
    if (lastUserText === null) return;
    if ((target.textContent || "").trim() === lastUserText) return;
    target.textContent = lastUserText;
    if (document.activeElement === target) placeCaretEnd(target);
    lastTranslation = lastUserText;
  };

  const attachResultEditing = () => {
    const target = findResultTarget();
    if (!target) return;

    if (target !== resultTarget) {
      resultTarget = target;
      target.contentEditable = "true";
      target.setAttribute("data-gtbs-editable", "true");
      target.spellcheck = false;
      target.addEventListener("input", onResultInput);
      target.addEventListener("keydown", onResultKeydown);
    } else if (target.contentEditable !== "true") {
      target.contentEditable = "true";
      target.setAttribute("data-gtbs-editable", "true");
    }

    const text = (target.textContent || "").trim();
    if (userIsEditingResult()) {
      restoreUserText(target);
    } else if (text) {
      lastTranslation = text;
      lastUserText = null;
    }
  };

  const userIsEditingResult = () => {
    return (
      resultTarget !== null &&
      (document.activeElement === resultTarget ||
        resultTarget.contains(document.activeElement))
    );
  };

  const onResultInput = (event) => {
    if (reversing) return;
    if (!event.isTrusted) return;
    if (!userIsEditingResult()) return;
    lastUserText = (resultTarget.textContent || "").trim();
    window.clearTimeout(reverseTimer);
    reverseTimer = window.setTimeout(reverseTranslate, REVERSE_DEBOUNCE_MS);
  };

  const onResultKeydown = (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      window.clearTimeout(reverseTimer);
      reverseTranslate();
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
    if (!resultTarget || reversing) return;

    const edited = (resultTarget.textContent || "").trim();
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

  let rescanScheduled = false;
  const scheduleRescan = () => {
    if (rescanScheduled) return;
    rescanScheduled = true;
    window.setTimeout(() => {
      rescanScheduled = false;
      injectStyle();
      attachResultEditing();
    }, 150);
  };

  injectStyle();
  attachResultEditing();

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
