# Conversation process and status appearance

Settings > Appearance > Conversation status strip offers Classic (default), Neon, Terminal, Candy, Glitch and Original. Selection is saved locally under statusAppearance, not sent to the gateway. Returning to the conversation reloads the selection. Saving failure displays a toast without changing the previous selection.

The status phrase bank, rotation timing, elapsed-time clock and completion notifications are unchanged. Text-style choices share the default whale-tail icon, the Official sway contour (one loop per 4 seconds). Two local 40 x 40 transparent GIFs play 96 downsampled contour frames at an exact 4-second cycle, avoiding multirow sprite translation and per-frame setData. GIF encoding uses cumulative delays, transparent-frame disposal, and fixed frame origins. The original contour atlases remain source material, not runtime images. Reduced-motion preferences disable text effects where supported; native GIF playback does not follow CSS reduced-motion settings.

Palette and official contour data adapted from https://github.com/01Virex/dsh-status-rotator (main retrieved 2026-10-19). MIT copyright notice is in docs/licenses/dsh-status-rotator.txt. Neon/Terminal/Glitch light-mode colors are darkened for contrast; fonts and effects are adapted to mobile, not a complete port of the plugin. No phrases, danmaku, telemetry or executable plugin code are imported.

## Running execution icon

Settings > Appearance > Execution icon (执行图标) selects the animation in the square loader that precedes the running process title (正在执行命令). The choice is stored locally under procIconStyle (default cells) and is never sent to the gateway; a failed write shows the save-failure toast and keeps the previous icon. Returning to the conversation or reopening Settings reloads the selection.

The default cells style is the original CSS 2 x 2 square grid (four cells blinking in sequence) and needs no image asset. Six alternatives ship as local 32 x 32 transparent GIFs in light and dark variants, each with exactly 72 frames over a 4-second loop: terra (rotating dotted orb), morph (dotted circle/triangle/square morph), grid (breathing 3x3 pulse), orbit (light dots circling a rounded-square track), ripple (expanding square ripples) and wave (evenly spaced waveform). The loader keeps its fixed 32rpx slot, so process-head geometry, titles and step rows do not move; only the loader animation changes, while the status strip's whale-tail contour, phrases, elapsed clock and completion notifications are untouched. The picker previews reuse the same loader markup as the real process head.

The loader is intentionally monochrome in both themes: neutral gray ink (#6C6C6C light, #969696 dark) with no accent color, matching the secondary label color. The default cells and the shared picker previews use the same grayscale ink; only opacity animates.

The terra and morph animations are inspired by TerraWork thinking-orbs (https://github.com/Jakubantalik/thinking-orbs, MIT, Copyright (c) Jakub Antalík). The license text is in docs/licenses/thinking-orbs.txt; the mini-program reimplements the motion as generated GIFs and imports no runtime source from that project.

Conversation activity icons are the regular glyphs from the locally installed DSH desktop frontend. Process layout follows ChatGroupSeat, ReasoningRow and tool detail disclosures. Tools and reasoning retain their step ordering without an extra tool-bundle fold. A turn/end is persisted in the semantic projection so completed history remains completed on reload; aborted/interrupted/error/max-tokens outcomes never become success. Pending tool calls without a final answer do not become completed merely because the running flag cleared.

Validation: Node regression tests; WeChat WXML/WXSS compilation; compiled-template fixture previews in light and dark themes. Not yet verified on a physical WeChat device or a live gateway conversation. Atlas playback and background-clip text should be confirmed on iOS and Android before publishing.

Process statistics and tool previews share the primary label row; long previews truncate with an ellipsis. Full arguments/results remain in the expandable detail body.

Command disclosures now follow desktop BashRow: description first, actual command first-line fallback, left tool glyph swapped for a chevron only on hover or touch press, unified terminal input/output card and exact-text copy. Expanded and completed commands retain their tool glyph at rest. File/search/web summaries use path/query/URL fields. Incomplete JSON streams never appear as serialized argument envelopes in the row; generic tool details retain raw arguments for inspection.

## Work-step display preferences

Settings > Conversation now mirrors the desktop Chat presentation-policy choices: compact, standard, detailed (default), verbose; collapse after completion (default) or next input. Preferences are local to this mini-program (not synchronized with desktop Host configuration). Compact/standard keep activity groups folded; standard shows live tool descriptions. Detailed shows current steps during execution, then applies collapse timing. Verbose retains open groups and bypasses automatic collapse; individual tool parameter/output disclosures remain independently controlled. Compact hides settled reasoning previews until requested. Manual folds survive streaming ticks; failed/interrupted groups default open.

Live tool-name-only frames now reach the projection, placeholder names are repaired, and assistant-stream frames establish running state when turn/start was missed. The last active group reports commands, tool result processing and response generation, followed by the actual turn outcome. Settings changes apply when returning to a conversation.

The active process group is placed after current narration, immediately above the whale progress strip. Completion restores chronological placement and applies the configured collapse timing. Completed headers use a permanent leading chevron; child disclosures retain their own glyphs at rest and have no trailing chevrons. Mouse hover or touch press swaps the leading glyph for a chevron, with 200ms release feedback on touch.
Within the running group, detail rows come first, followed by the separator and live status title (such as context preparation or reasoning), so the title itself sits immediately above the whale. This order applies only while running; completed groups keep the header above their expandable details.

Cached history no longer blocks live events. Follow snapshots restore the active attempt's compact text, reasoning and tool-argument records immediately, and later history pages replay the uncommitted prefix without duplicating settled messages. The first visible chunk is published immediately; subsequent chunks retain the 120ms coalescing window. These paths are covered by regression tests and native WXML compilation, not yet a physical-device live gateway test.
