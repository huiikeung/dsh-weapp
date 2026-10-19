# Plugin management

The mini-program plugin page follows the installed DSH desktop client's plugin-manager UI:

- Built-in configuration: subagent, web search, agent loop, terminal, limited to the Host's returned items.
- Experimental plugins: desktop's four pinned entries, unknown/new official entries, and enabled entries from More.
- More: the full official optional-plugin list, including disabled entries.
- Installed plugins: third-party packages; newer Host `official` flags take precedence over legacy optional/installed classification.

## Adding plugins

The toolbar installs packages into the connected DSH Host profile, not the phone. It uses the existing authenticated GatewayClient transport; no separate endpoint or shell execution is added.

1. `plugin-registries` reads the Host's configured registry and fallbacks.
2. `plugin-inspect` validates the npm spec, Git URL, archive or Host-local path. A refused inspection cannot start installation.
3. Clicking the centered Install button checks the source and starts installation only after an accepted inspection. The safety warning is visible before submission. Immediate activation defaults to off for manually entered packages.
4. `plugin-install` starts a correlated request. `plugin-install-state` and `plugin-install-log` update that task only; logs are bounded to 16,000 characters.
5. The final result refreshes the catalog. Restart requirements, failure, cancellation and overridden configuration remain distinct.
6. `plugin-install-cancel` is only a cancellation request; the UI waits for the final result. `plugin-install-status` reconciles the original installation ID after a disconnect or app restart, without blindly submitting another installation.

Pending installation IDs are stored per Host. Switching Hosts never moves an installation to the new connection. Registry credentials and logs are not persisted. Build scripts are never automatically approved: the specific dependency names and Host-side execution warning require explicit user confirmation.

Missing official optional plugins, including Codex and Claude Code subagents, open the installation sheet when enabled. The controller uses the Host catalog's exact `installTarget` and revalidates it before installation; these trusted catalog targets do not go through generic package inspection. These installations enable the plugin after installation.

The split-button's Agent creation action refreshes the available presets and requires `cordis`, matching the desktop Creator mode. It returns to Home and creates one new session with that preset, without sending an automatic user message. A Host switch invalidates the pending action.

The page includes Installed and Discover tabs. Discover mirrors the desktop empty state and centered index-source dialog. Sources are read from and saved to the connected Host, not mini-program storage. The dialog validates HTTP(S) URLs, rejects credentials/fragments and duplicate sources, supports removal, and displays a third-party trust warning. Saving waits for Host acknowledgement, then re-reads the authoritative list. Failed or uncertain saves require a refresh before further changes. Host switches and page disposal invalidate pending results.

The mobile market bridge forwards `plugin-market-indexes`, `plugin-market-set-indexes` and `plugin-market-search` to the desktop's `pluginMarket.listIndexes`, `setIndexes` and `search`. Discover supports source selection, text search, pagination and opening the existing installation flow with the Host-returned compatible version and registry. It never fetches arbitrary indexes directly from the phone. The installed gateway originally lacked these routes; `scripts/install-plugin-market-bridge.cjs <absolute gateway package directory> --check` validates compatibility without changes. Omit `--check` to back up and update the two adapter files. Normally restart DSH afterward; this script does not restart processes, change profiles, or enable plugins. The DSH plugin-market bundle must be enabled. Other Hosts need the same routes; upgrading the gateway may replace a local bridge patch.

Installation failures use a short phase-based catalog banner, such as “插件安装失败 / 查看详情”. Raw Host errors and package-manager logs remain inside the installation dialog; they are never used as the catalog banner text. Market errors likewise stay in Discover and do not overwrite Installed catalog errors.

Existing built-in detail pages are preserved; this change does not introduce a generic settings-schema editor or uninstall workflow.

## Validation

Run `node --test tests/plugins.test.js tests/plugin-market.test.js` for grouping, transport correlation, inspection refusal, installation progress, cancellation, reconnect recovery, Host isolation, script approval, persistent task identities, exact official installation targets, Creator session presets, source validation/mutation, bridge routing, bounded summaries and page bindings.

The WeChat developer tools' `wcc.exe` and `wcsc.exe` can compile `pages/plugins/plugins.wxml` and `pages/plugins/plugins.wxss`. Real package installation should be verified with an explicitly chosen trusted package in a non-production DSH profile.

Discover categories come from `search.result.metadata.categories`, using localized titles rather than a fixed list. Category pills wrap on mobile with a blue selected state. Selection is sent to the Host as `query.category`, combined with search text and preserved for pagination. Switching sources clears the category; a removed declaration resets to All and reloads. The market bridge forwards and validates this parameter; reapply the bridge and normally restart DSH after upgrading an older local bridge. No process is automatically restarted.
