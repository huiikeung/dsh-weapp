# Plugin detail parity audit

Reference: installed DeepSeek Harness `resources/app.asar`, read-only inspection on 2026-10-19. No profile credentials or secrets were read.

## Built-in configuration

- Shell: prefers `pwsh-sandbox` over `bash-sandbox`; command timeout and output cap; inherited defaults, override/reset, staged save/discard.
- Agent loop: parallel tool-call cap, same form lifecycle.
- Subagent: recursion depth, capacity, model selection enablement, provider/model catalog, retained unavailable choices, minimum selection, revision conflicts.
- Web search: Messages vs Search/Fetch selection, separate endpoints and limits, search count 1-50, credential configured state and write-only replacement, docs guide (copied for opening outside WeChat).

All values come from `plugin-settings`. Writes use `plugin-settings-mutate` with `expectedRevision`; no guessed defaults. Unknown/unsupported/read-only features remain disabled. Disconnects and host switches invalidate async replies. Failed/uncertain writes preserve drafts and require rereading before another save.

## Other installed desktop plugin UI contributions

Scanned installed `@deepseek-ai/*/lib/client.js` for `plugins.bundle.config` and `plugins.row.config` registrations. Dedicated bundle contributions are:

- `dsh-experimental-cot-translation-bundle`: translation provider catalog, target language, privacy and paid/anonymous provider notices.
- `dsh-experimental-voice-input-bundle`: recognition provider/language, local/cloud notices, preparation estimates, advertised download sources, progress, steps, cancel/retry, errors. Uses existing speech wire protocol; polls only while visible. WeChat uses the OS microphone instead of the desktop browser's input-device picker.

Other installed bundles use shared metadata/component/source presentation; no additional dedicated row configuration contribution was found in the inspected desktop build. Unknown third-party custom React UI cannot be executed inside WeChat.

## Gateway compatibility

Existing `plugin-settings`, `plugin-settings-mutate`, model catalog and speech APIs are reused. `scripts/install-plugin-settings-bridge.cjs` exposes two missing desktop capabilities: web-search credential describe/set and translation provider availability. It verifies source anchors, backs up both changed files, is idempotent, and rolls back a failed write. Credential requests are restricted to references used by active web-search scopes, honor read-only settings, never return raw secrets and redact write failures.

```powershell
node scripts/install-plugin-settings-bridge.cjs 'C:\Users\0the\.dsh\profiles\desktop\node_modules\dsh-plugin-mobile-gateway' --check
node scripts/install-plugin-settings-bridge.cjs 'C:\Users\0the\.dsh\profiles\desktop\node_modules\dsh-plugin-mobile-gateway'
```

Restart DSH/gateway to load the bridge. Installing or updating the gateway package can replace this local bridge; rerun the compatibility check first. No automatic restart, download, provider selection or credential write is performed by installing the bridge.

## Verification

Automated fixtures cover validation, reset/default semantics, revision conflicts, stale host replies, read-only/disconnect handling, write-only credentials, speech response correlation, locale switching, JS-only startup, and plugin UI structure. Native WeChat WXML/WXSS compilation is also run. Live simulator screenshots and connected-host end-to-end saves require the user's running developer-tools/DSH session and have not been claimed as verified.

## 2026-10-19 upload-root and blank-page hardening

Mini-program runtime now lives exclusively under `miniprogram/`. Four built-in pages initialize their title/description even without a cached catalog; the settings view uses direct WXML inclusion and an explicit window-sized scroll viewport rather than relying on native scroll-view flex sizing. Tests execute real page onLoad/onShow in both languages and run native-compiled WXML to assert visible labels, disconnected state, and retry UI. Live simulator access remains blocked by the disabled IDE service port.

## Confirmed dependency-scanner omission (2026-10-19)

The viewport/template changes above did not address the reported blank page. Developer Tools 2.02.2608080's installed JavaScript dependency analyzer omits `require()` calls inside object spread. Consequently, `Page({ ...require('./settings-actions'), ... })` does not declare the settings module as a packaging dependency; the same pattern also omitted `voice-actions`. The IDE cache contained the detail page but neither action module.

Both mixins now use explicit top-level imports and `Object.assign`, matching the working plugin-list page. `tests/wechat-plugin-dependencies.test.js` invokes the analyzer extracted read-only from the installed IDE archive: old fixtures reproduce both missing dependencies, while current sources resolve the action modules and settings utilities. Non-JS preprocessors and filesystem watchers are stubbed, not the JavaScript parser or dependency walker. The native analyzer test skips when that IDE installation is absent; the explicit-import regression always runs. This confirms the packaging defect and its correction, not a completed live simulator or gateway save test.
