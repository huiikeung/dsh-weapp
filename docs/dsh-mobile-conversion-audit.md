# dsh-mobile Conversion Audit: Remaining Gaps

## Scope

This follow-up uses the current [parity matrix](harmonyos-parity-matrix.md), [device acceptance runbook](harmonyos-device-acceptance.md), and live HarmonyOS workspace. It does not repeat the full reference-source review. The latest read-only native-core run passed 33 tests; that is unit/mock evidence, not live-device or live-Gateway parity.

Priority: **P0** blocks a credible connected-client release; **P1** is important portable capability; **P2** is breadth/polish. “Missing” means not yet proven end-to-end, not necessarily absent as a scaffold.

## P0: Live Gateway lifecycle

**Evidence:** harmonyos/native-core/src/main/ets/network/GatewayClient.ets, protocol/GatewayRequests.ets, state/SessionStore.ets, protocol/RequestCorrelation.ets, and tests/gateway-pairing.test.mjs. Tests cover pairing/reconnect mocks, stale candidates, request correlation and history reset. The device runbook records no repeatable live Gateway E2E.

**Gap / acceptance:** Pair against a real dsh-plugin-mobile-gateway using v2 QR and manual entry; observe hello/auth completion, workspace/session snapshot, stream a response, reconnect, switch gateway, and reject stale responses. Verify existing request fields remain unchanged: type, requestId, sessionId, rpcId (question/approval), approvalId, beforeSeq/nextBeforeSeq (history), and transferId/offset (files). Same-gateway reconnect reopens the selected session; gateway identity switch clears old projection; expired/consumed pairing never reaches connected state.

**External dependencies:** DSH WebUI with mobile connection/device authentication enabled, dsh-plugin-mobile-gateway, a valid unexpired QR/Base64URL payload, and a LAN-routable ws(s) endpoint.

## P0: Device acceptance loop

**Evidence:** harmonyos-device-acceptance.md records API 26, unsigned HAP build, HDC target 127.0.0.1:5555, and that real Gateway E2E has not run. Current routes are in harmonyos/native-app/entry/src/main/ets/pages/Index.ets; runtime permissions are in harmonyos/native-app/entry/src/main/module.json5.

**Gap / acceptance:** Rebuild with documented DevEco JBR/JDK; record HAP SHA-256; install and cold-launch; test invalid/expired pairing; grant and deny camera, notification, document-picker and microphone permissions; verify foreground return. Record device/API, app version, HAP hash, Gateway/plugin version, endpoint scheme/port and failure stage without recording payloads or tokens.

**External dependencies:** DevEco API 26 toolchain, matching JBR/Hvigor/OHPM/HDC, authorized HarmonyOS device/emulator, and signed HAP for real-device testing (unsigned HAP is emulator-only).

## P1: Conversation fidelity

**Evidence:** harmonyos/native-app/entry/src/main/ets/pages/SessionPage.ets now has conversation, queue, trajectory, context, fleet, files, questions, approvals, attachment and download surfaces. harmonyos/native-core/src/main/ets/state/SessionStore.ets and protocol/GatewayDtos.ets supply projection data. The matrix still records condensed trajectory/context and incomplete Markdown/code/image rendering and full event aggregation.

**Acceptance:** Feed fixture events for user, streamed assistant chunks, reasoning, tool-call delta plus result, image/file blocks, status/failure and older history. Render every semantic item once and in sequence order; keep live tail separate; preserve scroll anchor when prepending. Trajectory detail must expose arguments/results/schema/error/timing/usage, not only summary tiles.

**External dependency:** Fixture Gateway frames matching miniprogram/utils/protocol.js semantics and device screenshot/rotation or tablet-window checks.

## P1: Attachments and voice

**Evidence:** native-core/src/main/ets/common/AttachmentTransfer.ets, AttachmentPicker.ets, AttachmentCache.ets, VoiceDictation.ets and SessionPage integration exist. Unit checks cover sequential chunks, digest mismatch, cancellation/generation, cache safety and dictation cleanup. The matrix still identifies incomplete upload cancellation/receipt validation, attachment cards/rich previews, host voice-plugin transport, hold/slide gestures and privacy copy.

**Acceptance:** Upload using file-upload-open, sequential file-upload-chunk with exact offset/nextOffset, then file-upload-finish receipt. Disconnect mid-transfer and prove stale cleanup does not cancel a new connection. Download must reject bad Base64/offset/size/hash and publish only after SHA-256 validation. For voice, deny permission, start/stop/cancel, background, and change gateway/session context; late callbacks must not mutate the draft. With voice-capable Gateway, transcript remains editable and raw audio is not persisted as an attachment.

**External dependencies:** HarmonyOS picker/microphone/speech runtime and permissions, Gateway upload/download and voice capability, and sample PDF/image/code files.

## P1: Prompt recovery and notification routing

**Evidence:** SessionPage sends question-answer, question-cancel and approval-response; native-core/tests/history-pagination.test.mjs and request-correlation.test.mjs cover session/RPC scoping. native-core/src/main/ets/common/NotificationService.ets publishes grouped notifications with a session WantAgent.

**Acceptance:** Keep two sessions/prompts pending, navigate/reconnect, and resolve only by exact sessionId plus rpcId (approval also approvalId). An unrelated/ambiguous response must not clear a prompt. Trigger a background notification and verify tap opens the intended session; denied notification authorization must not crash. Manual disconnect must not silently reconnect.

**External dependencies:** Concurrent prompt frames from Gateway, notification authorization, background-capable device and real lifecycle transitions.

## P2: Feature breadth and adaptive behavior

**Evidence:** native-app/entry/src/main/ets/pages/PluginsPage.ets offers catalog and enable toggle; SchedulePage.ets offers catalog and enable toggle; AppSettingsPage.ets exposes settings. The matrix identifies missing plugin detail/configuration, schedule edit/delete/history, cache management/diagnostics, full team task/member navigation, files/insights/diagnostics routes and broad tablet/foldable parity.

**Acceptance:** With fixture catalog/tasks, plugin detail/config and schedule edit/delete must show server-confirmed results, stale/error states and retry; rejected mutations must not leave optimistic state. On tablet/rotation, navigation, composer, trajectory, file preview and safe areas remain usable. Cache UI reports bytes and clears only selected categories.

**External dependencies:** Gateway capability/version support for mutations, phone/tablet/rotation device matrix and fixture team/task/cache data.

## Release gate

Do not call conversion production-ready until P0 checks pass on at least one authorized device plus reachable fixture Gateway, and P1 conversation/prompt/file/voice checks have explicit evidence. Unit tests and HAP build do not prove live protocol compatibility, system permissions, background routing, RTC or adaptive layouts.

## Read-only checks

- Baselines read: harmonyos-parity-matrix.md and harmonyos-device-acceptance.md.
- Command: node --test harmonyos/native-core/tests/*.test.mjs. Observed result: 33 passed, 0 failed.
- No source code changed for this audit; only this report is added.
