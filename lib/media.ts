import type { Crop } from './crop.ts';
import { isClipActive } from './timeline.mjs';
export type Clip = {
  crop?: Crop;
  file: File;
  url: string;
  video: HTMLVideoElement;
  mono: Float32Array | null;
  duration: number;
  width: number;
  height: number;
  thumbnail: string;
  alignedThumbnail?: string;
  peaks: number[];
  audioError?: string;
};
export type Box = { x: number; y: number; width: number; height: number };
export const RATE = 16000;
export function waitEvent(
  target: HTMLVideoElement,
  event: string,
  action?: () => void,
  signal?: AbortSignal,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('影片讀取逾時，請重新選擇影片。')),
      20000,
    );
    const abort = () => finish(new DOMException('已取消', 'AbortError'));
    const good = () => finish();
    const bad = () =>
      finish(new Error('Safari 無法讀取這段影片，請先轉成 H.264 MP4。'));
    function finish(error?: Error) {
      clearTimeout(timeout);
      signal?.removeEventListener('abort', abort);
      target.removeEventListener(event, good);
      target.removeEventListener('error', bad);
      if (error) reject(error);
      else resolve();
    }
    target.addEventListener(event, good, { once: true });
    target.addEventListener('error', bad, { once: true });
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) return abort();
    try {
      action?.();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('影片操作失敗'));
    }
  });
}
export async function seek(
  video: HTMLVideoElement,
  time: number,
  signal?: AbortSignal,
) {
  const target = Math.max(0, Math.min(time, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2)
    return;
  await waitEvent(
    video,
    'seeked',
    () => {
      video.currentTime = target;
    },
    signal,
  );
}
export function snapshot(video: HTMLVideoElement) {
  const c = document.createElement('canvas');
  c.width = 480;
  c.height = Math.round((480 * video.videoHeight) / video.videoWidth);
  c.getContext('2d')!.drawImage(video, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', 0.8);
}
export async function loadClip(file: File): Promise<Clip> {
  if (file.size > 250 * 1024 * 1024)
    throw new Error('手機版每部影片上限 250 MB，請先縮短或降低解析度。');
  const url = URL.createObjectURL(file),
    video = document.createElement('video');
  video.playsInline = true;
  video.muted = true;
  video.preload = 'auto';
  video.setAttribute('playsinline', '');
  video.className = 'processing-video';
  video.setAttribute('aria-hidden', 'true');
  document.body.appendChild(video);
  try {
    await waitEvent(video, 'loadeddata', () => {
      video.src = url;
      video.load();
    });
    if (
      !Number.isFinite(video.duration) ||
      video.duration < 3 ||
      video.duration > 180
    )
      throw new Error('手機版支援每部 3 秒至 3 分鐘的影片。');
    if (!video.videoWidth) throw new Error('檔案沒有可讀取的影像。');
    const thumbnail = snapshot(video);
    let mono: Float32Array | null = null;
    let audioError: string | undefined;
    // Downsample after decode; only small mono fingerprints remain in memory.
    const context = new AudioContext({ sampleRate: RATE });
    try {
      const decoded = await context.decodeAudioData(await file.arrayBuffer());
      const offline = new OfflineAudioContext(
        1,
        Math.ceil(decoded.duration * RATE),
        RATE,
      );
      const source = offline.createBufferSource();
      source.buffer = decoded;
      source.connect(offline.destination);
      source.start();
      mono = (await offline.startRendering()).getChannelData(0).slice();
      let sum = 0;
      for (let i = 0; i < mono.length; i++) sum += mono[i] * mono[i];
      if (sum / mono.length < 1e-10) {
        mono = null;
        audioError = '沒有可辨識的聲音，請使用手動對齊。';
      }
    } catch {
      audioError = '無法解碼音訊，可手動設定時間差。';
    } finally {
      await context.close();
    }
    const peaks = Array.from({ length: 64 }, (_, i) => {
      if (!mono) return 0;
      let p = 0;
      const start = Math.floor((i * mono.length) / 64),
        end = Math.floor(((i + 1) * mono.length) / 64);
      for (let j = start; j < end; j += 16) p = Math.max(p, Math.abs(mono[j]));
      return p;
    });
    return {
      file,
      url,
      video,
      mono,
      duration: video.duration,
      width: video.videoWidth,
      height: video.videoHeight,
      thumbnail,
      peaks,
      audioError,
    };
  } catch (error) {
    video.remove();
    video.removeAttribute('src');
    video.load();
    URL.revokeObjectURL(url);
    throw error;
  }
}
export function disposeClip(clip: Clip) {
  clip.video.pause();
  clip.video.removeAttribute('src');
  clip.video.load();
  clip.video.remove();
  URL.revokeObjectURL(clip.url);
}
export function drawComposition(
  ctx: CanvasRenderingContext2D,
  clips: Clip[],
  boxes: Box[],
  width: number,
  height: number,
  elapsed: number,
  remaining: number[],
  order: number[],
) {
  ctx.fillStyle = '#000';
  ctx.fillRect(0, 0, width, height);
  for (const i of order) {
    const box = boxes[i];
    const x = Math.round(box.x * width),
      y = Math.round(box.y * height),
      w = Math.round(box.width * width),
      h = Math.round(box.height * height);
    // A finished clip explicitly paints black even when it overlaps another clip.
    if (isClipActive(elapsed, remaining[i])) {
      const clip = clips[i],
        crop = clip.crop;
      if (crop)
        ctx.drawImage(
          clip.video,
          crop.x * clip.width,
          crop.y * clip.height,
          crop.width * clip.width,
          crop.height * clip.height,
          x,
          y,
          w,
          h,
        );
      else ctx.drawImage(clip.video, x, y, w, h);
    } else {
      ctx.fillStyle = '#000';
      ctx.fillRect(x, y, w, h);
    }
  }
}
export function supportedMime() {
  if (typeof MediaRecorder === 'undefined') return '';
  return (
    [
      'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
      'video/mp4',
      'video/webm;codecs=vp9,opus',
      'video/webm;codecs=vp8,opus',
      'video/webm',
    ].find((m) => MediaRecorder.isTypeSupported(m)) ?? ''
  );
}
