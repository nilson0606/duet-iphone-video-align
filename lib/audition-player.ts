import { seek } from './media.ts';
import { timeline } from './timeline.mjs';
import { abortReason, mediaDeadline } from './media-deadline.ts';

/** Owns only the audition video elements and audio graph, never the editor's players. */
export class AuditionPlayer {
  private context: AudioContext | null = null;
  private volume: GainNode | null = null;
  private sources: MediaElementAudioSourceNode[] = [];
  private operation: AbortController | null = null;
  private disposed = false;
  private videos: (HTMLVideoElement | null)[];
  private createContext: () => AudioContext;
  constructor(
    videos: (HTMLVideoElement | null)[],
    createContext: () => AudioContext = () => new AudioContext(),
  ) {
    this.videos = videos;
    this.createContext = createContext;
  }
  private activate() {
    if (this.disposed) throw new Error('試聽已關閉。');
    if (!this.context) {
      const context = this.createContext();
      this.context = context;
      this.volume = context.createGain();
      // Leave headroom when both recordings are audible.
      this.volume.gain.value = 0.5;
      this.volume.connect(context.destination);
      for (const video of this.videos) {
        if (!video) continue;
        const source = context.createMediaElementSource(video);
        source.connect(this.volume);
        this.sources.push(source);
        video.muted = false;
        video.playbackRate = 1;
      }
    }
    return this.context.resume();
  }
  pauseAll() {
    this.operation?.abort();
    this.operation = null;
    this.videos.forEach((video) => video?.pause());
    if (this.volume) this.volume.gain.value = 0;
  }
  pauseOne(index: number) {
    if (this.operation) {
      this.pauseAll();
      return;
    }
    this.videos[index]?.pause();
  }
  seekOne(index: number, time: number) {
    if (this.operation) this.pauseAll();
    const video = this.videos[index];
    if (!video || !Number.isFinite(time) || video.readyState < 1) return;
    video.pause();
    video.currentTime = Math.max(0, Math.min(time, video.duration - 0.001));
  }
  async playOne(index: number) {
    const video = this.videos[index];
    if (!video) return;
    if (this.operation) this.pauseAll();
    const operation = new AbortController();
    this.operation = operation;
    try {
      const resumed = this.activate();
      if (video.ended) video.currentTime = 0;
      this.volume!.gain.value = 0.5;
      // Both resume() and play() run in the button's gesture before the first await.
      await mediaDeadline(
        Promise.all([resumed, video.play()]),
        operation.signal,
        10000,
        '試聽播放未啟動，請再按一次播放。',
      );
    } catch (error) {
      if (this.operation === operation) video.pause();
      throw error;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  async playTogether(offset: number, position: number) {
    const [a, b] = this.videos;
    if (!a || !b) throw new Error('請先載入兩部影片。');
    const plan = timeline(a.duration, b.duration, offset);
    if (!Number.isFinite(position) || position < 0 || position >= plan.overlap)
      throw new Error('試聽位置須在兩部影片都有內容的範圍內。');
    this.pauseAll();
    const operation = new AbortController();
    this.operation = operation;
    try {
      const resumed = this.activate();
      this.volume!.gain.value = 0;
      // Prime both original-media players on this tap so iPhone permits later seeks/play.
      const primed = [a, b].map((video) =>
        video.play().then(() => {
          if (this.operation === operation) video.pause();
        }),
      );
      await mediaDeadline(
        Promise.all([resumed, ...primed]),
        operation.signal,
        10000,
        '試聽播放未啟動，請再按一次同時播放。',
      );
      await Promise.all(
        [a, b].map((video, index) =>
          seek(video, plan.starts[index] + position, operation.signal),
        ),
      );
      if (operation.signal.aborted) throw abortReason(operation.signal);
      await mediaDeadline(
        Promise.all([a.play(), b.play()]),
        operation.signal,
        10000,
        '兩部影片尚未準備好，請重試。',
      );
      if (operation.signal.aborted) throw abortReason(operation.signal);
      if (a.paused || b.paused)
        throw new Error('其中一部影片未持續播放，請再試一次同時播放。');
      this.volume!.gain.value = 0.5;
    } catch (error) {
      if (this.operation === operation) this.pauseAll();
      throw error;
    } finally {
      if (this.operation === operation) this.operation = null;
    }
  }
  dispose() {
    if (this.disposed) return;
    this.disposed = true;
    this.pauseAll();
    this.sources.forEach((source) => source.disconnect());
    this.volume?.disconnect();
    void this.context?.close().catch(() => {});
  }
}
