import { healthStore } from '@kit.HealthServiceKit';
import { common } from '@kit.AbilityKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

interface HealthMetric {
  value: number | null;
  unit: string;
}

interface HealthMetrics {
  steps: HealthMetric;
  sleepMinutes: HealthMetric;
  heartRate: HealthMetric;
  restingHeartRate: HealthMetric;
  oxygenSaturation: HealthMetric;
  bodyMass: HealthMetric;
}

interface HealthSummary {
  steps: number | null;
  sleepMinutes: number | null;
  metrics: HealthMetrics;
  start: string;
  end: string;
  timeZone: string;
  source: string;
}

function localDate(millis: number): string {
  const date: Date = new Date(millis);
  const mm: string = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd: string = date.getDate().toString().padStart(2, '0');
  const yyyy: string = date.getFullYear().toString().padStart(4, '0');
  return mm + '/' + dd + '/' + yyyy;
}

/** 健康摘要：只做固定指标聚合，不导出原始记录 */
class HealthConnector implements ConnectorAdapter {
  id: string = 'health';
  private inited: boolean = false;

  available(): boolean {
    return true;
  }

  async authorize(): Promise<boolean> {
    return true;
  }

  private async ensureInit(): Promise<void> {
    if (this.inited) {
      return;
    }
    const context: common.UIAbilityContext | undefined = AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
    if (context === undefined) {
      return;
    }
    try {
      await healthStore.init(context);
      this.inited = true;
    } catch (err) {
      Logger.warn('health init failed');
    }
  }

  private async sum(type: healthStore.DataType, startMs: number, endMs: number): Promise<number | null> {
    try {
      const scopes: healthStore.AggregateMetricScope[] = ['sum'];
      const metrics: Record<string, healthStore.AggregateMetricScope[]> = {};
      metrics['sum'] = scopes;
      const group: healthStore.GroupOption = { unitType: 3, duration: 1 };
      const request: healthStore.AggregateRequest = {
        dataType: type,
        metrics: metrics,
        groupBy: group,
        startLocalDate: localDate(startMs),
        endLocalDate: localDate(endMs)
      };
      const results: healthStore.AggregateResult[] = await healthStore.aggregateData(request);
      if (results.length === 0) {
        return null;
      }
      const fields: Object = results[0].fields;
      const value: Object | undefined = (fields as Record<string, Object>)['sum'];
      return typeof value === 'number' ? value as number : null;
    } catch (err) {
      return null;
    }
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool !== 'health.daily-summary') {
      throw new Error('tool_unsupported');
    }
    const start: string = String(args.start);
    const end: string = String(args.end);
    const timeZone: string = String(args.timeZone);
    const startMs: number = Date.parse(start);
    const endMs: number = Date.parse(end);
    await this.ensureInit();
    const steps: number | null = await this.sum(healthStore.samplePointHelper.dailyActivities.DATA_TYPE, startMs, endMs);
    const metrics: HealthMetrics = {
      steps: { value: steps, unit: 'count' },
      sleepMinutes: { value: null, unit: 'min' },
      heartRate: { value: null, unit: 'bpm' },
      restingHeartRate: { value: null, unit: 'bpm' },
      oxygenSaturation: { value: null, unit: '%' },
      bodyMass: { value: null, unit: 'kg' }
    };
    const summary: HealthSummary = {
      steps: steps,
      sleepMinutes: null,
      metrics: metrics,
      start: start,
      end: end,
      timeZone: timeZone,
      source: 'harmonyos-health'
    };
    return summary as Object;
  }

  cancel(invocationId: string): void {
  }
}

export const healthConnector: HealthConnector = new HealthConnector();
