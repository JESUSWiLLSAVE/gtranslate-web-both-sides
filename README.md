# Google Translate — Type in Both Sides (Firefox extension)

Makes the result field on [translate.google.com](https://translate.google.com) editable so you can type into **both** fields and the translation keeps updating.

## How it works

- **Left (source) field** — already editable; works exactly as Google built it.
- **Right (result) field** — the extension makes it contenteditable. When you type there:
  - it waits ~700 ms after you stop typing (or press <kbd>Enter</kbd>),
  - clicks Google's own "Swap languages" button so the direction reverses,
  - puts your edited text into the source field and dispatches an `input` event so Google re-translates it.

So the loop is: type English → see French → edit the French → see the updated English, and so on, in both directions.

## Install (temporary, any Firefox)

1. Open `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on…**.
3. Pick `manifest.json` from this folder.

The extension stays loaded until Firefox restarts.

## Install (persistent)

Zip the folder contents (`manifest.json` + `content.js` at the zip root) and sign it via [addons.mozilla.org](https://addons.mozilla.org/developers/) — either submit for listing or use self-distribution signing.

## Files

| File | Purpose |
| --- | --- |
| `manifest.json` | Manifest V3 config, content script registered on `translate.google.com` |
| `content.js` | Makes the result field editable, reverse-translates your edits |

## Notes & limits

- Google changes the page's obfuscated CSS class names from time to time. `content.js` tries several selectors (aria-labels first, class-name hooks as fallback). If editing ever stops working after a Google redesign, update `SOURCE_SELECTORS` / `RESULT_SELECTORS` / `SWAP_SELECTORS` at the top of `content.js`.
- While you are actively typing in the result field, a translation arriving from an earlier source edit can replace your text — that is Google re-rendering the node. Pause typing for a moment and edit again.
- No permissions, no network access, no data collection: it is a single content script that only touches the page's DOM.
