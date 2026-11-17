export class GatewayTransportPolicy {
  static allowsRtc(endpoint:string):boolean{const lower=endpoint.toLowerCase();return lower.startsWith('wss://')&&lower.indexOf('relay')<0;}
}
