# Gateway Request Factory Coverage

Reference: `.reference/kmp/gateway/GatewayProtocol.kt` GatewayRequests. The additive ArkTS factory is `harmonyos/native-core/src/main/ets/protocol/GatewayRequest.ets`. Only ping is wired through its lane in GatewayClient. Generic `make` can encode caller-supplied fields but does not supply factory validation or KMP defaults.

| Kotlin factory (line) | Status |
| --- | --- |
| pluginVersions (95) | Not ported (generic make only) |
| pluginDetail (98) | Not ported (generic make only) |
| pluginUpdate (104) | Implemented; not integrated |
| hostScheduleList (111) | Not ported (generic make only) |
| scheduleView (120) | Not ported (generic make only) |
| scheduleCreate (123) | Not ported (generic make only) |
| scheduleEdit (134) | Not ported (generic make only) |
| hostScheduleHistory (145) | Not ported (generic make only) |
| scheduleRun (152) | Not ported (generic make only) |
| scheduleDeleteInactive (155) | Not ported (generic make only) |
| pluginCatalog (160) | Not ported (generic make only) |
| pluginBundleSetEnabled (164) | Implemented; not integrated |
| pluginEntrySetEnabled (173) | Not ported (generic make only) |
| sessionAgentPreset (182) | Not ported (generic make only) |
| selectAgentPreset (190) | Not ported (generic make only) |
| simple (199) | Implemented; not integrated |
| createSession (202) | Implemented; not integrated |
| archiveSession (212) | Not ported (generic make only) |
| renameSession (216) | Not ported (generic make only) |
| ping (223) | Implemented and integrated |
| sessionControl (226) | Not ported (generic make only) |
| tasks (233) | Not ported (generic make only) |
| scheduleCatalog (235) | Not ported (generic make only) |
| scheduleList (237) | Not ported (generic make only) |
| scheduleHistory (239) | Not ported (generic make only) |
| scheduleUpdate (248) | Not ported (generic make only) |
| scheduleDelete (269) | Not ported (generic make only) |
| goal (278) | Not ported (generic make only) |
| editGoal (280) | Not ported (generic make only) |
| goalAction (300) | Not ported (generic make only) |
| search (320) | Not ported (generic make only) |
| directories (326) | Not ported (generic make only) |
| createDirectory (334) | Not ported (generic make only) |
| createWorkspace (343) | Not ported (generic make only) |
| setDefault (351) | Not ported (generic make only) |
| selectModel (360) | Not ported (generic make only) |
| setPermission (377) | Not ported (generic make only) |
| slashCommands (387) | Not ported (generic make only) |
| slashCommandOptions (397) | Not ported (generic make only) |
| selectSlashCommandOption (408) | Not ported (generic make only) |
| saveDefaultModel (424) | Not ported (generic make only) |
| history (438) | Implemented; not integrated |
| attachment (462) | Not ported (generic make only) |
| fileList (474) | Not ported (generic make only) |
| fileResolve (486) | Not ported (generic make only) |
| fileDownloadOpen (495) | Not ported (generic make only) |
| fileDownloadRead (511) | Not ported (generic make only) |
| fileDownloadCancel (521) | Not ported (generic make only) |
| subscribe (530) | Implemented; not integrated |
| sessionCancel (545) | Not ported (generic make only) |
| message (554) | Not ported (generic make only) |
| queueEdit (599) | Not ported (generic make only) |
| queueUpdate (611) | Implemented; not integrated |
| commandExecute (621) | Not ported (generic make only) |
| questionAnswer (644) | Not ported (generic make only) |
| questionCancel (666) | Implemented; not integrated |
| approvalResponse (678) | Not ported (generic make only) |

Lane bookkeeping implements queue ordering and coalescing only. Runtime transport correlation, timeout recovery, deferred requests, and integration of other factories remain outstanding. Pairing and decoder parity require further edge-case review and real gateway validation.
