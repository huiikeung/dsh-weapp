/**
 * 工作步骤展示偏好（对齐小程序 pages/session/utils/work-step-presentation.js）。
 *
 * 四个档位控制「过程组」的折叠细节：
 * - compact  简洁：完成回合后收拢，过程组内不展开细节
 * - standard 标准：收拢，但运行中仍显示细节
 * - detailed 详细：收拢，展开后按过程组分段显示历史
 * - verbose  完全展开：不再收拢，过程组逐组显示
 */
export interface WorkStepOption {
  id: string;
  label: string;
}

export interface WorkStepPolicy {
  foldCompletedTurns: boolean;
  /** collapsed | history | none */
  stepGrouping: string;
  liveProcessDetail: boolean;
  settledReasoningPreview: boolean;
}

export class WorkStepPresentation {
  static readonly MODE_KEY: string = 'workStepMode';
  static readonly TIMING_KEY: string = 'workStepTiming';

  static modes(): WorkStepOption[] {
    return [
      { id: 'compact', label: '简洁' },
      { id: 'standard', label: '标准' },
      { id: 'detailed', label: '详细' },
      { id: 'verbose', label: '完全展开' }
    ];
  }

  static timings(): WorkStepOption[] {
    return [
      { id: 'completion', label: '回答结束后' },
      { id: 'next-input', label: '下次有新消息时' }
    ];
  }

  static normalizeMode(value: string): string {
    for (const option of WorkStepPresentation.modes()) {
      if (option.id === value) {
        return value;
      }
    }
    return 'detailed';
  }

  static normalizeTiming(value: string): string {
    for (const option of WorkStepPresentation.timings()) {
      if (option.id === value) {
        return value;
      }
    }
    return 'completion';
  }

  static modeLabel(id: string): string {
    const normalized: string = WorkStepPresentation.normalizeMode(id);
    for (const option of WorkStepPresentation.modes()) {
      if (option.id === normalized) {
        return option.label;
      }
    }
    return '详细';
  }

  static timingLabel(id: string): string {
    const normalized: string = WorkStepPresentation.normalizeTiming(id);
    for (const option of WorkStepPresentation.timings()) {
      if (option.id === normalized) {
        return option.label;
      }
    }
    return '回答结束后';
  }

  static policy(mode: string): WorkStepPolicy {
    const normalized: string = WorkStepPresentation.normalizeMode(mode);
    if (normalized === 'compact') {
      return {
        foldCompletedTurns: true,
        stepGrouping: 'collapsed',
        liveProcessDetail: false,
        settledReasoningPreview: false
      };
    }
    if (normalized === 'standard') {
      return {
        foldCompletedTurns: true,
        stepGrouping: 'collapsed',
        liveProcessDetail: true,
        settledReasoningPreview: true
      };
    }
    if (normalized === 'verbose') {
      return {
        foldCompletedTurns: false,
        stepGrouping: 'none',
        liveProcessDetail: false,
        settledReasoningPreview: true
      };
    }
    return {
      foldCompletedTurns: true,
      stepGrouping: 'history',
      liveProcessDetail: true,
      settledReasoningPreview: true
    };
  }
}
