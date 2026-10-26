# Session switching: local-first performance

## Baseline

On 2026-10-26, `git fetch --all --prune` completed successfully. Local `main`
and `origin/main` both pointed to `d16ac89c3ffd8892fd13d7aa47d034b06c9eeea7`
(v0.9.42), with zero commits ahead/behind and a clean working tree before edits.

## Implemented

- Inactive text projections and parsed Markdown survive A -> B -> A and page
  unload/recreation. The active page takes ownership rather than retaining a
  reference to the previous page, its timers, requests, draft or approvals.
- Keys include host, session, working directory, viewport width, theme, locale,
  font style and history format. Restored rows still pass the existing source
  comparison; edits, removals and streaming updates remain authoritative.
- At most four inactive entries and 6 MiB of estimated data are retained.
  Estimation is bounded and does not stringify the conversation. This is a
  cache eviction metric, not an assertion about process heap usage. Images,
  attachment rows and file/change projections are rebuilt to avoid stale paths.
- Manual cache clearing and memory warnings invalidate the retained views.
  Generation checks prevent an old page from repopulating a cleared cache.
- Memory cache hits no longer synchronously read/write the disk LRU index.
  Index touches coalesce for 500 ms and are flushed before capacity eviction.
- The home page warms at most four displayed sessions from existing disk
  cache, sequentially, after 750 ms idle. Reads use asynchronous storage;
  JSON parsing and event reconstruction still run on the logic thread.
  Navigation, hiding, host/list changes and busy foreground state cancel
  scheduling; delayed reads cannot overwrite foreground writes or cleared data.
- Tapping a session navigates before store/cache hydration. The session page
  paints a loading shell first, then restores the selected session after 32 ms;
  it also skips projecting the previously active conversation during that
  transition. This improves time-to-page, not necessarily time-to-message.

## Deliberate boundaries

This release does NOT preload uncached history over the network. Older gateways
may omit request IDs; background responses require dedicated ownership and
foreground-handoff handling before network prefetch is safe. Local warmup never
changes subscriptions, unread state, active session or pagination.

The existing 2,000-event local tail, cursor resume, history paging, source
validation and bounded WXML window remain unchanged. Initial uncached loads,
full semantic-row traversal and disk-miss synchronous fallback still exist.
No sub-second device latency claim is made from Node tests.

## Acceptance

Run `node --test tests/*.test.js`, `node scripts/check-miniprogram-package.cjs`
and `node scripts/stamp-build.cjs`. The source budget is unchanged. Long
implementation comments were moved to `session-cache-implementation-notes.md`,
with their first lines retained beside the original code.

On real iOS/Android devices, separately measure tap-to-visible-text P50/P95 for:

1. Same-page A -> B -> A, including long histories and changing live tails.
2. Back to home and reopening a previously visited conversation.
3. Fresh process with disk cache, before and after idle warming.
4. Uncached conversation on direct and relay connections.
5. Rapid switches, identical IDs on different hosts, cache clearing, theme/font
   changes, offline opening, image reload and memory pressure.

Confirm unchanged drafts, scroll-to-latest behavior, complete older pagination,
no cross-session text, and final compiled package sizes in WeChat DevTools.
