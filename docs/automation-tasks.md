# Automation tasks

The sidebar and task manager use the name 自动化任务. The sidebar clock is a local 24-unit SVG in the same 44rpx slot and 20rpx text gap as the other entries; its drawn edge is inset to match their visual weight.

The page follows the installed DSH desktop task manager: search title/instruction/session ID, All/Enabled/Inactive filters, chronological rows, a task detail sheet with Rule and Saved Run Records tabs, linked-session navigation, confirmed deletion and conflict-aware editing. New opens a blank session just as desktop does; it does not silently send a prompt or create a scheduled job.

Rule editing supports once, fixed interval (hours/minutes/seconds), daily, weekdays, weekly and five-field Cron. All changes retain the complete expected record for Host compare-and-update. Unchanged timing is omitted so a name-only edit does not shift a schedule. One-shot input preserves seconds; explicit IANA time zones are passed to Host for DST, future-time and zone validation. Unlike desktop's searchable zone menu and visual monthly Cron helper, mobile currently uses text inputs for IANA zones and Cron expressions.

Run history uses the existing authenticated `schedule-history` route, correlated by requestId. It supports newest-first records, prompt expansion, cursor pagination, deduplication, retention information and retry. Host changes, disconnects, task changes and page disposal invalidate stale results. History errors stay within this page rather than leaking into session notifications.

No pause/resume/run-now controls are invented: the inspected desktop exposes rule editing and deletion, and inactive tasks are read-only. No new gateway patch or restart is required for these routes.

Validation: `node --test tests/automation.test.js tests/schedule-state.test.js`. WXML/WXSS are compiled with WeChat developer-tools compilers. Browser previews use the compiled WXML with synthetic fixtures only, never live task mutations. Real-device execution, real scheduled delivery, and live edits/deletion were not performed.
