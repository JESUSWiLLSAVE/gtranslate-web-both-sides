/**
 * Google Translate — Type in Both Sides
 *
 * Makes the translation-result field on translate.google.com editable.
 * - Left (source) field: already editable, works normally.
 * - Right (result) field: made contenteditable. When you edit it, the
 *   extension swaps the language direction and translates your edited
 *   text back, so both sides keep updating.
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

  let resultTarget = null;
  let lastTranslation = "";
  let reverseTimer = null;
  let reversing = false;

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
    if (text && !userIsEditingResult()) {
      lastTranslation = text;
    }
  };

  const userIsEditingResult = () => {
    return (
      resultTarget !== null &&
      (document.activeElement === resultTarget ||
        resultTarget.contains(document.activeElement))
    );
  };

  const onResultInput = () => {
    if (reversing) return;
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

  const setSourceValue = (textarea, value) => {
    const descriptor = Object.getOwnPropertyDescriptor(
      HTMLTextAreaElement.prototype,
      "value"
    );
    if (descriptor && descriptor.set) {
      descriptor.set.call(textarea, value);
    } else {
      textarea.value = value;
    }
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

  const reverseTranslate = async () => {
    if (!resultTarget || reversing) return;

    const edited = (resultTarget.textContent || "").trim();
    const source = findSource();
    if (!source) return;

    const previousTranslation = lastTranslation;

    if (edited === previousTranslation) return;
    reversing = true;

    try {
      const swap = findSwapButton();
      if (swap && previousTranslation) {
        swap.click();
        const settled = await poll(
          () =>
            source.value.trim() === previousTranslation ||
            source.value.trim() === "",
          SWAP_SETTLE_TIMEOUT_MS
        );
        if (!settled && source.value.trim() === previousTranslation) return;
      }
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
