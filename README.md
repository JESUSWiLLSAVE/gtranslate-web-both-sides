# Google Translate - Type in Both Sides (Firefox extension)

Makes the result field on [translate.google.com](https://translate.google.com) editable so you can type into **both** fields and the translation keeps updating.

## How it works

- **Left (source) field** - already editable; works exactly as Google built it.
- **Right (result) field** - the extension makes it content editable. When you type there:
  - it waits ~700 ms after you stop typing (or press <kbd>Enter</kbd>),
  - sends your edited text to Google's `translate_a/single` endpoint to translate it back into the source language,
  - writes the back-translation into the left field **silently** - the selected languages never swap sides.

If the language codes can't be determined (e.g. no `sl`/`tl` in the URL and detection fails), it falls back to clicking Google's "Swap languages" button.

## Install (temporary, any Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Pick `manifest.json` from this folder.

The extension stays loaded until Firefox restarts.

## Install (persistent)

(Will add Firefox Add-on link here soon)

## Notes & limits

- Google changes the page's obfuscated CSS class names from time to time. `content.js` tries several selectors (aria-labels first, class-name hooks as fallback). If editing ever stops working after a Google redesign, update `SOURCE_SELECTORS` / `RESULT_SELECTORS` / `SWAP_SELECTORS` at the top of `content.js`.
- While you are actively typing in the result field, a translation arriving from an earlier source edit can replace your text - that is Google re-rendering the node. Pause typing for a moment and edit again.
- The back-translation uses Google's public `translate_a/single` endpoint (`host_permissions` covers `translate.googleapis.com`); no keys, no other network access, nothing stored.
