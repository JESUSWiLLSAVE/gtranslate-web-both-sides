# Google Translate - Type in Both Sides (userscript)

A Violentmonkey/Tampermonkey userscript that makes the result field on [translate.google.com](https://translate.google.com) editable, so you can type into **both** fields and the translation keeps updating.

## How it works

- **Left (source) field** - already editable; works exactly as Google built it.
- **Right (result) field** - the script hides Google's result node and puts its own editable overlay in its place, so Google's re-renders can never clobber what you type. When you type there:
  - it waits ~700 ms after you stop typing (or press <kbd>Enter</kbd>),
  - sends your edited text to Google's `translate_a/single` endpoint to translate it back into the source language,
  - writes the back-translation into the left field **silently** - the selected languages never swap sides.

So the loop is: type English → see French → edit the French → see the updated English, all while the language selectors stay exactly where they are.

If the language codes can't be determined (e.g. no `sl`/`tl` in the URL and detection fails), it falls back to clicking Google's "Swap languages" button.

## Install

1. Install a userscript manager if you don't have one:
   - [Violentmonkey](https://violentmonkey.github.io/) (recommended)
   - [Tampermonkey](https://www.tampermonkey.net/)
   - [Greasemonkey](https://www.greasespot.net/)
3. Install the script, either:
   - **From the repo:** open the raw file at
     `https://raw.githubusercontent.com/JESUSWiLLSAVE/gtranslate-web-both-sides/main/google-translate-both-sides.user.js`
     - your userscript manager will offer to install it, or
   - **Manually:** open the manager's dashboard → create new script → paste the contents of `google-translate-both-sides.user.js` → save.
4. Open or reload [translate.google.com](https://translate.google.com).

## Notes & limits

- Google changes the page's obfuscated CSS class names from time to time. The script tries several selectors (aria-labels first, class-name hooks as fallback). If editing ever stops working after a Google redesign, update `SOURCE_SELECTORS` / `RESULT_SELECTORS` / `SWAP_SELECTORS` at the top of the script.
- If Google rebuilds the result area from scratch, the script rebuilds its overlay too - preserving what you were typing if you edited it within the last few seconds.
- The back-translation uses Google's public `translate_a/single` endpoint; no keys, no other network access, nothing stored.
- The old Firefox WebExtension version was removed in the pivot to a userscript; if you ever want it back, it's in the git history (commits before `8220bad`).
