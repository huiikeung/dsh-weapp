/**
 * 工作步骤展示偏好（对齐小程序 pages/session/utils/work-step-presentation.js）。
 *
 * 四个档位控制「过程组」的折叠细节：
 * - compact  简洁：完成回合后收拢，过程组内不展开细节
 * - standard 标准：收拢，但运行中仍显示细节
 * - detailed 详细：收拢，展开后按过程组分段显示历史
 * - verbose  完全展开：不再收拢，过程组逐组显示
 * - reading  阅读：过程实时折叠成一行摘要（带步骤计数），轮次结束后仍可展开回看
 */
import { PreferencesStore } from '../common/PreferencesStore';

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
  /** 阅读档：折叠行显示步骤计数摘要（对齐交互阅读的折叠摘要） */
  readingSummary: boolean;
}

export class WorkStepPresentation {
  static readonly MODE_KEY: string = 'workStepMode';
  /** 默认档位：阅读（运行中折叠成计数摘要，结束后整轮收起） */
  static readonly DEFAULT_MODE: string = 'reading';
  /** 一次性默认值迁移标记：老用户升级后也切到新默认档，之后尊重用户自己的选择 */
  static readonly DEFAULT_APPLIED_KEY: string = 'workStepDefaultApplied';
  static readonly TIMING_KEY: string = 'workStepTiming';

  static modes(): WorkStepOption[] {
    return [
      { id: 'compact', label: '简洁' },
      { id: 'standard', label: '标准' },
      { id: 'detailed', label: '详细' },
      { id: 'reading', label: '阅读' },
      { id: 'verbose', label: '完全展开' }
    ];
  }

  /** 首次启动/升级一次性把默认档切到「阅读」；之后不再覆盖用户选择 */
  static ensureDefaultMode(prefs: PreferencesStore): string {
    const stored: string = WorkStepPresentation.normalizeMode(prefs.getString(WorkStepPresentation.MODE_KEY, WorkStepPresentation.DEFAULT_MODE));
    if (prefs.getBoolean(WorkStepPresentation.DEFAULT_APPLIED_KEY, false)) {
      return stored;
    }
    prefs.putBoolean(WorkStepPresentation.DEFAULT_APPLIED_KEY, true);
    prefs.putString(WorkStepPresentation.MODE_KEY, WorkStepPresentation.DEFAULT_MODE);
    return WorkStepPresentation.DEFAULT_MODE;
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
    return WorkStepPresentation.DEFAULT_MODE;
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
        settledReasoningPreview: false,
        readingSummary: false
      };
    }
    if (normalized === 'standard') {
      return {
        foldCompletedTurns: true,
        stepGrouping: 'collapsed',
        liveProcessDetail: true,
        settledReasoningPreview: true,
        readingSummary: false
      };
    }
    if (normalized === 'reading') {
      return {
        foldCompletedTurns: true,
        // 运行中展开（步骤在限高容器里滚），收工后折叠成计数摘要行
        stepGrouping: 'history',
        liveProcessDetail: true,
        settledReasoningPreview: true,
        readingSummary: true
      };
    }
    if (normalized === 'verbose') {
      return {
        foldCompletedTurns: false,
        stepGrouping: 'none',
        liveProcessDetail: false,
        settledReasoningPreview: true,
        readingSummary: false
      };
    }
    return {
      foldCompletedTurns: true,
      stepGrouping: 'history',
      liveProcessDetail: true,
      settledReasoningPreview: true,
      readingSummary: false
    };
  }
}
