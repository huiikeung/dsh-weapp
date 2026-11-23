import { abilityAccessCtrl, common, Permissions } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { BusinessError } from '@kit.BasicServicesKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

interface LocationResult {
  latitude: number;
  longitude: number;
  precision: string;
  horizontalAccuracyMeters: number;
  sampledAt: string;
}

function sampledAtNow(): string {
  const date: Date = new Date();
  const offsetMinutes: number = -date.getTimezoneOffset();
  const sign: string = offsetMinutes >= 0 ? '+' : '-';
  const abs: number = Math.abs(offsetMinutes);
  const hh: string = Math.floor(abs / 60).toString().padStart(2, '0');
  const mm: string = (abs % 60).toString().padStart(2, '0');
  const yyyy: string = date.getFullYear().toString().padStart(4, '0');
  const mo: string = (date.getMonth() + 1).toString().padStart(2, '0');
  const dd: string = date.getDate().toString().padStart(2, '0');
  const h: string = date.getHours().toString().padStart(2, '0');
  const mi: string = date.getMinutes().toString().padStart(2, '0');
  const ss: string = date.getSeconds().toString().padStart(2, '0');
  return yyyy + '-' + mo + '-' + dd + 'T' + h + ':' + mi + ':' + ss + sign + hh + ':' + mm;
}

class LocationConnector implements ConnectorAdapter {
  id: string = 'location';
  private canceled: boolean = false;
  private authorized: boolean = false;

  available(): boolean {
    return true;
  }

  async authorize(): Promise<boolean> {
    if (this.authorized) {
      return true;
    }
    const context: common.UIAbilityContext | undefined =
      AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
    if (context === undefined) {
      return false;
    }
    const permissions: Permissions[] = ['ohos.permission.APPROXIMATELY_LOCATION', 'ohos.permission.LOCATION'];
    try {
      const manager = abilityAccessCtrl.createAtManager();
      const result = await manager.requestPermissionsFromUser(context, permissions);
      this.authorized = result.authResults.every((code: number) => code === 0);
      return this.authorized;
    } catch (err) {
      Logger.warn('location authorize failed: ' + JSON.stringify(err));
      return false;
    }
  }

  private locate(precise: boolean): Promise<LocationResult> {
    this.canceled = false;
    const request: geoLocationManager.CurrentLocationRequest = {
      priority: geoLocationManager.LocationRequestPriority.FIRST_FIX,
      scenario: geoLocationManager.LocationRequestScenario.UNSET,
      maxAccuracy: 0,
      timeoutMs: 10000
    };
    return new Promise<LocationResult>((resolve: (value: LocationResult) => void, reject: (reason: Error) => void) => {
      geoLocationManager.getCurrentLocation(request).then((location: geoLocationManager.Location) => {
        if (this.canceled) {
          reject(new Error('cancelled'));
          return;
        }
        const accuracy: number = location.accuracy > 0 ? location.accuracy : 2000;
        resolve({
          latitude: location.latitude,
          longitude: location.longitude,
          precision: precise ? 'precise' : 'coarse',
          horizontalAccuracyMeters: precise ? accuracy : Math.max(1500, accuracy),
          sampledAt: sampledAtNow()
        });
      }).catch((err: BusinessError) => {
        reject(new Error(err.message));
      });
    });
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'location.current') {
      return await this.locate(false) as Object;
    }
    if (tool === 'location.precise') {
      return await this.locate(true) as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
    this.canceled = true;
  }
}

export const locationConnector: LocationConnector = new LocationConnector();
