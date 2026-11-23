import { avSession } from '@kit.AVSessionKit';
import { ConnectorAdapter } from './DeviceConnectors';
import { Logger } from '../common/Logger';

interface MusicState {
  playbackState: number;
  playbackSeconds?: number;
  requested?: string;
  source: string;
}

interface MusicRow {
  id: string;
  title: string;
  artist: string;
}

interface MusicSearchResult {
  items: MusicRow[];
  source: string;
}

/** 本机媒体会话控制：只控制当前活跃播放器，不读取私有曲库 */
class MusicConnector implements ConnectorAdapter {
  id: string = 'music';
  private controller: avSession.AVSessionController | undefined = undefined;

  available(): boolean {
    return true;
  }

  async authorize(): Promise<boolean> {
    return true;
  }

  private async currentController(): Promise<avSession.AVSessionController | undefined> {
    if (this.controller !== undefined) {
      return this.controller;
    }
    try {
      const descriptors: avSession.AVSessionDescriptor[] = await avSession.getAllSessionDescriptors();
      for (let i = 0; i < descriptors.length; i++) {
        const created: avSession.AVSessionController = await avSession.createController(descriptors[i].sessionId);
        this.controller = created;
        return created;
      }
    } catch (err) {
      Logger.warn('music controller failed');
    }
    return undefined;
  }

  private async snapshot(requested: string): Promise<MusicState> {
    const controller = await this.currentController();
    if (controller === undefined) {
      const empty: MusicState = { playbackState: 0, source: 'harmonyos-media-session' };
      if (requested.length > 0) {
        empty.requested = requested;
      }
      return empty;
    }
    try {
      const state: avSession.AVPlaybackState = await controller.getAVPlaybackState();
      const result: MusicState = {
        playbackState: state.state !== undefined ? state.state : 0,
        source: 'harmonyos-media-session'
      };
      if (state.position !== undefined) {
        result.playbackSeconds = Math.max(0, Math.floor(state.position.elapsedTime / 1000));
      }
      if (requested.length > 0) {
        result.requested = requested;
      }
      return result;
    } catch (err) {
      const fallback: MusicState = { playbackState: 0, source: 'harmonyos-media-session' };
      if (requested.length > 0) {
        fallback.requested = requested;
      }
      return fallback;
    }
  }

  private async send(command: avSession.AVControlCommandType, value: number): Promise<void> {
    const controller = await this.currentController();
    if (controller === undefined) {
      throw new Error('device_offline');
    }
    const payload: avSession.AVControlCommand = { command: command };
    if (command === 'seek' || command === 'setSpeed') {
      payload.parameter = value;
    }
    try {
      await controller.sendControlCommand(payload);
    } catch (err) {
      throw new Error('outcome_unknown');
    }
  }

  async invoke(tool: string, args: Record<string, Object>): Promise<Object> {
    if (tool === 'music.search') {
      const empty: MusicSearchResult = { items: [], source: 'harmonyos-media-store' };
      return empty as Object;
    }
    if (tool === 'music.state') {
      return await this.snapshot('') as Object;
    }
    if (tool === 'music.play') {
      await this.send('play', 0);
      return await this.snapshot('music.play') as Object;
    }
    if (tool === 'music.pause') {
      await this.send('pause', 0);
      return await this.snapshot('music.pause') as Object;
    }
    if (tool === 'music.seek') {
      const seconds: number = Number(args.seconds);
      await this.send('seek', Math.max(0, Math.floor(seconds * 1000)));
      return await this.snapshot('music.seek') as Object;
    }
    throw new Error('tool_unsupported');
  }

  cancel(invocationId: string): void {
  }
}

export const musicConnector: MusicConnector = new MusicConnector();
