// MapsConnector.ets — 地图连接器（对齐 iOS maps.* 工具契约）
//
// 工具：maps.open / maps.search / maps.directions / maps.geocode
// 实现：华为官方文档化通道（Want 直拉 Petal 地图 + petalmaps:// 深链 + petalmaps.com App Linking），
//       不依赖私有 API、不引入地图 SDK。
//
// 与 iOS 的差异（诚实降级，不伪造数据）：
//   - geocode/search 不返回本地候选坐标列表（无地理编码 SDK），返回可点击的地图搜索链接；
//   - directions 不返回逐步 turn-by-turn 文本（Petal 无公开路径规划 REST），路线在拉起的地图内展示。
//
// 坐标系：中国大陆 GCJ02、台湾/海外 WGS84（Petal 官方约定）。location 连接器上报已是此约定，直接透传。

import { common, Want, bundleManager } from '@kit.AbilityKit';
import { geoLocationManager } from '@kit.LocationKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

const PETAL_BUNDLE = 'com.huawei.hmos.maps.app';
const PETAL_SCHEME = 'petalmaps';
const PETAL_APP_LINK = 'https://www.petalmaps.com';
const LINK_SOURCE = 'com.flukit.app';

interface MapPoint {
  latitude: number;
  longitude: number;
  name: string;
}

interface MapLinkItem {
  cardURL: string;
  url: string;
  label: string;
}

interface MapResult {
  ready: boolean;
  detail: string;
  mapLinks: MapLinkItem[];
}

/** 网关 device-tools 结果校验要求的候选结构（对齐 iOS：name/latitude/longitude/address） */
interface MapPlaceItem {
  name: string;
  latitude: number;
  longitude: number;
  address: string;
}

interface MapPlacesResult {
  items: MapPlaceItem[];
  truncated: boolean;
  source: string;
}

/** maps.open 回执：网关校验要求 status/latitude/longitude/name/mode(/transport) */
interface MapOpenResult {
  status: string;
  latitude: number;
  longitude: number;
  name: string;
  mode: string;
  transport?: string;
}

function num(args: Record<string, Object>, key: string): number {
  const value: Object | undefined = args[key];
  return typeof value === 'number' ? value as number : NaN;
}

function optNum(args: Record<string, Object>, key: string): number | undefined {
  const value: Object | undefined = args[key];
  return typeof value === 'number' ? value as number : undefined;
}

function optStr(args: Record<string, Object>, key: string): string {
  const value: Object | undefined = args[key];
  return typeof value === 'string' ? value as string : '';
}

function pointName(latitude: number, longitude: number, name: string): string {
  if (name.length > 0) {
    return name;
  }
  return latitude.toFixed(5) + ',' + longitude.toFixed(5);
}

function fmtPoint(latitude: number, longitude: number): string {
  return latitude + ',' + longitude;
}

function transportType(transport: string): string {
  if (transport === 'walking') {
    return 'walk';
  }
  if (transport === 'cycling') {
    return 'ride';
  }
  return 'drive';
}

function vehicleType(transport: string): number {
  if (transport === 'walking') {
    return 1;
  }
  if (transport === 'cycling') {
    return 2;
  }
  return 0;
}

function linkFor(latitude: number, longitude: number, name: string,
  mode: string, transport: string,
  startLat?: number, startLon?: number): MapLinkItem {
  const type: string = transportType(transport);
  const label: string = pointName(latitude, longitude, name);
  if (mode === 'show' || mode === 'search') {
    return {
      cardURL: PETAL_SCHEME + '://search?q=' + encodeURIComponent(label),
      url: PETAL_APP_LINK + '/search/?q=' + encodeURIComponent(label),
      label: label
    };
  }
  const hasStart: boolean = startLat !== undefined && startLon !== undefined
    && Number.isFinite(startLat) && Number.isFinite(startLon);
  const saddr: string = hasStart ? 'saddr=' + fmtPoint(startLat as number, startLon as number) + '&' : '';
  return {
    cardURL: PETAL_SCHEME + '://navigation?' + saddr + 'daddr=' + fmtPoint(latitude, longitude)
      + '&type=' + type + '&utm_source=' + LINK_SOURCE,
    url: PETAL_APP_LINK + '/navigate/?' + saddr + 'daddr=' + fmtPoint(latitude, longitude) + '&type=' + type,
    label: label
  };
}

class MapsConnector implements ConnectorAdapter {
  id: string = 'maps';
  private authorized: boolean = false;

  available(): boolean {
    // querySchemes 未配置或低版本时 canOpenLink 可能抛错：按「可尝试拉起」处理
    try {
      return bundleManager.canOpenLink(PETAL_SCHEME + '://');
    } catch (err) {
      return true;
    }
  }

  async authorize(): Promise<boolean> {
    // 地图拉起不需要受控权限，querySchemes 探测即可
    this.authorized = true;
    return this.authorized;
  }

  private context(): common.UIAbilityContext | undefined {
    return AppStorage.get<common.UIAbilityContext>('uiAbilityContext');
  }

  private async openLink(url: string): Promise<boolean> {
    const context: common.UIAbilityContext | undefined = this.context();
    if (context === undefined) {
      return false;
    }
    try {
      await context.openLink(url, { appLinkingOnly: false });
      return true;
    } catch (err) {
      Logger.warn('maps openLink failed: ' + url);
      return false;
    }
  }

  private async startPetal(uri: string, latitude: number, longitude: number,
    name: string, transport: string): Promise<boolean> {
    const context: common.UIAbilityContext | undefined = this.context();
    if (context === undefined) {
      return false;
    }
    const want: Want = {
      bundleName: PETAL_BUNDLE,
      uri: uri,
      parameters: {
        linkSource: LINK_SOURCE,
        destinationLatitude: latitude,
        destinationLongitude: longitude,
        destinationName: name,
        vehicleType: vehicleType(transport)
      }
    };
    try {
      await context.startAbility(want);
      return true;
    } catch (err) {
      Logger.warn('maps startAbility failed: ' + uri);
      return false;
    }
  }

  private result(ready: boolean, detail: string, link: MapLinkItem): MapResult {
    const links: MapLinkItem[] = [link];
    const out: MapResult = { ready: ready, detail: detail, mapLinks: links };
    return out;
  }

  /** maps.open：mode = show（查看/搜索地点）| directions（路径规划）| navigate（直接导航） */
  private async open(args: Record<string, Object>): Promise<MapResult> {
    const latitude: number = num(args, 'latitude');
    const longitude: number = num(args, 'longitude');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('invalid_argument: latitude/longitude required');
    }
    let mode: string = optStr(args, 'mode');
    if (mode.length === 0) {
      mode = 'show';
    }
    let transport: string = optStr(args, 'transport');
    if (transport.length === 0) {
      transport = 'driving';
    }
    const name: string = optStr(args, 'name');
    const link: MapLinkItem = linkFor(latitude, longitude, name, mode, transport);
    const label: string = pointName(latitude, longitude, name);

    if (mode === 'show' || mode === 'search') {
      const ok: boolean = await this.openLink(link.url);
      return this.result(ok, ok ? '已在地图打开「' + label + '」' : '未找到可打开的地图应用', link);
    }

    // directions / navigate：起点未指定时 Petal 默认取当前定位（Want 无起点参数）
    const startLat: number | undefined = optNum(args, 'startLatitude');
    const startLon: number | undefined = optNum(args, 'startLongitude');
    if (startLat === undefined || startLon === undefined) {
      const uri: string = mode === 'navigate' ? 'maps://navigation' : 'maps://routes';
      const ok: boolean = await this.startPetal(uri, latitude, longitude, label, transport);
      const detail: string = ok
        ? (mode === 'navigate' ? '导航已发起：' : '路径规划已发起：') + label + '（起点=当前定位）'
        : '拉起 Petal 地图失败（未安装）';
      return this.result(ok, detail, link);
    }
    const ok: boolean = await this.openLink(link.cardURL);
    const detail: string = ok
      ? '路线已发起：' + pointName(startLat, startLon, '') + ' → ' + label
      : '深链拉起失败（Petal 地图未安装）';
    return this.result(ok, detail, link);
  }

  /** maps.search：附近/关键词搜索 → 拉起 Petal 地图搜索页（不伪造本地候选列表） */
  private async search(args: Record<string, Object>): Promise<MapResult> {
    const query: string = optStr(args, 'query');
    if (query.length === 0) {
      throw new Error('invalid_argument: query required');
    }
    const latitude: number | undefined = optNum(args, 'latitude');
    const longitude: number | undefined = optNum(args, 'longitude');
    let q: string = query;
    // 附近搜索：把坐标并入关键词（Petal 搜索链接无显式 near 参数）
    if (latitude !== undefined && longitude !== undefined) {
      q = query + ' near ' + latitude.toFixed(4) + ',' + longitude.toFixed(4);
    }
    const link: MapLinkItem = {
      cardURL: PETAL_SCHEME + '://search?q=' + encodeURIComponent(q),
      url: PETAL_APP_LINK + '/search/?q=' + encodeURIComponent(q),
      label: query
    };
    const ok: boolean = await this.openLink(link.url);
    return this.result(ok, ok ? '已在地图搜索「' + query + '」' : '未找到可打开的地图应用', link);
  }

  /** maps.directions：起终点路线（起点缺省=当前定位） */
  private async directions(args: Record<string, Object>): Promise<MapResult> {
    const endLat: number = num(args, 'endLatitude');
    const endLon: number = num(args, 'endLongitude');
    if (!Number.isFinite(endLat) || !Number.isFinite(endLon)) {
      throw new Error('invalid_argument: endLatitude/endLongitude required');
    }
    let transport: string = optStr(args, 'transport');
    if (transport.length === 0) {
      transport = 'driving';
    }
    const startLat: number | undefined = optNum(args, 'startLatitude');
    const startLon: number | undefined = optNum(args, 'startLongitude');
    const endName: string = optStr(args, 'endName');
    const startName: string = optStr(args, 'startName');
    const inner: Record<string, Object> = {
      'latitude': endLat,
      'longitude': endLon,
      'name': endName,
      'mode': 'directions',
      'transport': transport
    } as Record<string, Object>;
    if (startLat !== undefined) {
      inner['startLatitude'] = startLat;
    }
    if (startLon !== undefined) {
      inner['startLongitude'] = startLon;
    }
    const out: MapResult = await this.open(inner);
    if (out.ready && startLat !== undefined && startLon !== undefined) {
      out.detail = '路线已发起：' + pointName(startLat, startLon, startName) + ' → ' + pointName(endLat, endLon, endName);
    }
    return out;
  }

  /**
   * maps.geocode：地址 → 坐标候选。
   * 优先用系统正地理编码（geoLocationManager.getAddressesFromLocationName），
   * 拿不到时返回空列表（诚实降级，不伪造坐标）。结果结构必须与网关校验一致。
   */
  private async geocode(args: Record<string, Object>): Promise<MapPlacesResult> {
    const address: string = optStr(args, 'address');
    if (address.length === 0) {
      throw new Error('invalid_request');
    }
    const rawLimit: number = optNum(args, 'limit') ?? 3;
    const limit: number = Math.max(1, Math.min(5, Math.round(rawLimit)));
    let items: MapPlaceItem[] = [];
    try {
      const request: geoLocationManager.GeoCodeRequest = {
        description: address,
        maxItems: limit,
        locale: 'zh'
      };
      const found: geoLocationManager.GeoAddress[] = await geoLocationManager.getAddressesFromLocationName(request);
      for (const one of found) {
        const lat: number | undefined = one.latitude;
        const lon: number | undefined = one.longitude;
        if (lat === undefined || lon === undefined) {
          continue;
        }
        const name: string = (one.placeName !== undefined && one.placeName.length > 0) ? one.placeName : address;
        const parts: string[] = [];
        const fields: (string | undefined)[] = [one.countryName, one.administrativeArea, one.locality, one.subLocality];
        for (const one2 of fields) {
          if (one2 !== undefined && one2.length > 0) {
            parts.push(one2);
          }
        }
        const addr: string = parts.length > 0 ? parts.join(' ') : name;
        items.push({ name: name, latitude: lat, longitude: lon, address: addr });
      }
    } catch (err) {
      Logger.warn('maps.geocode unavailable: ' + (err instanceof Error ? err.message : String(err)));
      items = [];
    }
    return { items: items.slice(0, limit), truncated: items.length > limit, source: 'android-geocoder' };
  }

  /** maps.search：本机没有 POI 检索能力，返回空候选（不伪造），由模型改用地图应用或经纬度。 */
  private async searchPlaces(args: Record<string, Object>): Promise<MapPlacesResult> {
    const query: string = optStr(args, 'query');
    if (query.length === 0) {
      throw new Error('invalid_request');
    }
    return { items: [], truncated: false, source: 'android-geocoder' };
  }

  /** maps.open：拉起地图并回执网关要求的字段（status/坐标/name/mode[/transport]） */
  private async openReceipt(args: Record<string, Object>): Promise<MapOpenResult> {
    const latitude: number = num(args, 'latitude');
    const longitude: number = num(args, 'longitude');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('invalid_request');
    }
    const modeRaw: string = optStr(args, 'mode');
    const mode: string = modeRaw === 'directions' ? 'directions' : 'show';
    const name: string = optStr(args, 'name');
    const inner: Record<string, Object> = {};
    inner['latitude'] = latitude;
    inner['longitude'] = longitude;
    inner['name'] = name;
    inner['mode'] = mode;
    if (mode === 'directions') {
      const transportRaw: string = optStr(args, 'transport');
      inner['transport'] = (transportRaw === 'walking' || transportRaw === 'transit') ? transportRaw : 'driving';
    }
    const shown: MapResult = await this.open(inner);
    const label: string = pointName(latitude, longitude, name);
    const out: MapOpenResult = {
      status: shown.ready ? 'ready' : 'handoff-requested',
      latitude: latitude,
      longitude: longitude,
      name: label,
      mode: mode
    };
    if (mode === 'directions') {
      const transport: Object | undefined = inner['transport'];
      out.transport = typeof transport === 'string' ? transport as string : 'driving';
    }
    return out;
  }

  /** maps.reverse-geocode：坐标 → 地址候选（系统逆地理，失败返回空列表） */
  private async reverseGeocode(args: Record<string, Object>): Promise<MapPlacesResult> {
    const latitude: number = num(args, 'latitude');
    const longitude: number = num(args, 'longitude');
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) {
      throw new Error('invalid_request');
    }
    const items: MapPlaceItem[] = [];
    try {
      const request: geoLocationManager.ReverseGeoCodeRequest = {
        latitude: latitude,
        longitude: longitude,
        maxItems: 1
      };
      const found: geoLocationManager.GeoAddress[] = await geoLocationManager.getAddressesFromLocation(request);
      for (const one of found) {
        const name: string = (one.placeName !== undefined && one.placeName.length > 0) ? one.placeName : '';
        const parts: string[] = [];
        const fields: (string | undefined)[] = [one.countryName, one.administrativeArea, one.locality, one.subLocality];
        for (const one2 of fields) {
          if (one2 !== undefined && one2.length > 0) {
            parts.push(one2);
          }
        }
        const addr: string = parts.length > 0 ? parts.join(' ') : name;
        items.push({
          name: name.length > 0 ? name : addr,
          latitude: latitude,
          longitude: longitude,
          address: addr
        });
      }
    } catch (err) {
      Logger.warn('maps.reverse-geocode unavailable');
    }
    return { items: items.slice(0, 1), truncated: false, source: 'android-geocoder' };
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'maps.open') {
      return await this.openReceipt(args) as Object;
    }
    if (tool === 'maps.reverse-geocode') {
      return await this.reverseGeocode(args) as Object;
    }
    if (tool === 'maps.search') {
      return await this.searchPlaces(args) as Object;
    }
    if (tool === 'maps.directions') {
      return await this.directions(args) as Object;
    }
    if (tool === 'maps.geocode') {
      return await this.geocode(args) as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
    // 拉起地图是一次性动作，无可取消的后台任务
  }
}

export const mapsConnector: MapsConnector = new MapsConnector();
