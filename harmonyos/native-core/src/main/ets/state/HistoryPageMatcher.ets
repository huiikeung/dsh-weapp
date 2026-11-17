import { GatewayFrame, RawSessionEvent } from '../protocol/GatewayDtos';

/** Distinguish an older page from a tail refresh while pagination is pending. */
export function isOlderHistoryPage(frame: GatewayFrame, cursor: number): boolean {
  if (cursor <= 0 || frame.resetRequired === true) return false;
  if (frame.beforeSeqPlaceholder === true || frame.beforeSeq === cursor) return true;
  if (frame.nextBeforeSeq !== undefined && frame.nextBeforeSeq < cursor) return true;
  const events: RawSessionEvent[] = frame.events ?? [];
  for (const event of events) {
    if (Number.isSafeInteger(event.seq) && event.seq >= 0 && event.seq < cursor) return true;
  }
  return false;
}
