import { HistorySyncConfiguration } from './HistoryReducer';

export interface HistoryGeneration { value: number; }
export class HistorySyncEngine {
  private nextGeneration: number = 0;
  private generations: Map<string, HistoryGeneration> = new Map();
  private timers: Map<string, number> = new Map();
  private closed: boolean = false;
  readonly configuration: HistorySyncConfiguration = { pageMessageLimit: 60, pageByteBudget: 4 * 1024 * 1024, pagesPerBatch: 2 };
  beginRequest(sessionId: string, timeoutMs: number, onTimeout: () => void): HistoryGeneration {
    this.ensureOpen(); this.clearTimer(sessionId);
    const generation = this.newGeneration(); this.generations.set(sessionId, generation);
    const timer = setTimeout(() => {
      if (this.isCurrent(generation, sessionId)) { this.generations.delete(sessionId); this.timers.delete(sessionId); onTimeout(); }
    }, timeoutMs);
    this.timers.set(sessionId, timer); return generation;
  }
  beginProcessing(sessionId: string): HistoryGeneration { this.ensureOpen(); this.clearTimer(sessionId); const g = this.newGeneration(); this.generations.set(sessionId, g); return g; }
  isCurrent(generation: HistoryGeneration, sessionId: string): boolean { return this.generations.get(sessionId)?.value === generation.value; }
  isActive(sessionId: string): boolean { return this.generations.has(sessionId); }
  finish(sessionId: string): void { this.clearTimer(sessionId); this.generations.delete(sessionId); }
  cancelAll(): void { for (const timer of this.timers.values()) clearTimeout(timer); this.timers.clear(); this.generations.clear(); }
  close(): void { this.cancelAll(); this.closed = true; }
  private newGeneration(): HistoryGeneration { this.nextGeneration += 1; return { value: this.nextGeneration }; }
  private clearTimer(sessionId: string): void { const timer = this.timers.get(sessionId); if (timer !== undefined) clearTimeout(timer); this.timers.delete(sessionId); }
  private ensureOpen(): void { if (this.closed) throw new Error('history sync engine closed'); }
}
