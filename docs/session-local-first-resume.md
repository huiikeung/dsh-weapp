# Local-first session history and reconnect recovery

The mini program restores a bounded local event window before contacting the
gateway. When it subscribes, it includes the highest durable event sequence it
already has. Gateways with `session-resume-v1` retain a bounded in-memory ring
and replay only when every sequence between that cursor and the opening
snapshot is available. In that case the gateway sends only the missing events
and a lightweight snapshot calibration (projection and assistant-stream
baseline), not a duplicate message tail. If continuity cannot be proven, it
sends a replacement snapshot and the client reconciles the tail as before.

If a gateway reports a non-empty history cursor but an empty opening tail, the
client keeps cached messages visible and requests a versioned page through that
cursor instead of presenting the session as empty. Delayed snapshots or tails
whose cursor is behind the local event sequence cannot move the displayed tail
or pagination cursor backward. Empty page replies echo `beforeSeq` so the client
can settle the matching request and show a retryable sync error rather than
leaving a spinner or claiming the session has no history.

Already-visited older history pages are also cached on-device by host, session,
format version, and cursor. The turn navigator reads those pages immediately,
including while offline; a gateway request is made only for a page not yet in
the local cache. The page cache shares the Settings > Storage cleanup path with
the rest of the conversation cache.

Opening the turn navigator immediately renders the locally available turns,
then warms older pages sequentially in the background. One opening is bounded
to eight pages, 500 additional turns, or 4 MiB of history data. Warm-up pauses
while a response is being generated and stops when the panel closes. The
navigator virtualizes its row rendering, keeping only a viewport-sized window
mounted while preserving the full scroll range. If the bounded warm-up stops
before the end of a very large session, reaching the older edge still loads the
next page and caches it for later visits.

The gateway replay ring is deliberately bounded: 32 sessions, 2,048 events and
512 KiB per session, with a one-hour idle expiry. A replay is capped at 256
events and 256 KiB. If any bound is exceeded, the gateway sends a fresh
snapshot instead of claiming continuity; the client keeps that snapshot
visible and requests a history tail to reconcile the gap. Old gateways ignore
the optional cursor and continue using their existing snapshot/history path.

## Enable the gateway bridge

The installer supports the WeChat and mobile gateway packages and makes
timestamped backups before changing either package. Run the compatibility
check first:

```sh
node scripts/install-session-resume-bridge.cjs \
  "$HOME/Downloads/dsh-plugin-weapp-gateway" --check
```

The checked-out source directory must be the package DSH actually loads; on the
desktop profile, verify `~/.dsh/profiles/desktop/node_modules/dsh-plugin-weapp-gateway`
resolves to that directory. If the check reports `compatible: true`, install
without `--check`. The installer makes timestamped source backups and does not
change the package version. Fully restart DSH (not just the Cloudflare tunnel)
to load the new capability. For the mobile gateway, replace the package name
with `dsh-plugin-mobile-gateway`. The installer is intentionally not run
automatically by the mini-program build.
