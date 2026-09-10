import { timeline, isClipActive } from './timeline.mjs';
export type Clip = {
  file: File;
  url: string;
  video: HTMLVideoElement;
  mono: Float32Array | null;
  duration: number;
  width: number;
  height: number;
  thumbnail: string;
  peaks: number[];
  audioError?: string;
};
export type Box = { x: number; y: number; width: number; height: number };
export const RATE = 16000;
export function waitEvent(
  target: HTMLVideoElement,
  event: string,
  action?: () => void,
) {
  return new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(
      () => finish(new Error('影片讀取逾時，請重新選擇影片。')),
      20000,
    );
    const good = () => finish();
    const bad = () =>
      finish(new Error('Safari 無法讀取這段影片，請先轉成 H.264 MP4。'));
    function finish(error?: Error) {
      clearTimeout(timeout);
      target.removeEventListener(event, good);
      target.removeEventListener('error', bad);
      if (error) reject(error);
      else resolve();
    }
    target.addEventListener(event, good, { once: true });
    target.addEventListener('error', bad, { once: true });
    action?.();
  });
}
export async function seek(video: HTMLVideoElement, time: number) {
  const target = Math.max(0, Math.min(time, video.duration - 0.001));
  if (Math.abs(video.currentTime - target) < 0.002 && video.readyState >= 2)
    return;
  await waitEvent(video, 'seeked', () => {
    video.currentTime = target;
  });
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
    if (isClipActive(elapsed, remaining[i]))
      ctx.drawImage(clips[i].video, x, y, w, h);
    else {
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
export async function renderMovie(args: {
  clips: Clip[];
  boxes: Box[];
  order: number[];
  offset: number;
  width: number;
  height: number;
  audio: number;
  context: AudioContext;
  nodes: Map<HTMLVideoElement, MediaElementAudioSourceNode>;
  signal: AbortSignal;
  onProgress: (n: number) => void;
}): Promise<Blob> {
  const {
    clips,
    boxes,
    order,
    offset,
    width,
    height,
    audio,
    context,
    nodes,
    signal,
    onProgress,
  } = args;
  const mime = supportedMime();
  if (!mime)
    throw new Error('這個瀏覽器不支援影片輸出，請用最新版 iPhone Safari。');
  const plan = timeline(clips[0].duration, clips[1].duration, offset),
    canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d')!;
  if (!canvas.captureStream) throw new Error('瀏覽器不支援畫面錄製。');
  const destination = context.createMediaStreamDestination(),
    gains: GainNode[] = [];
  let stream: MediaStream | undefined;
  let recorder: MediaRecorder | undefined;
  let wake: { release: () => Promise<void> } | undefined;
  try {
    // Resume and prime both media elements directly in the user's gesture.
    const resumed = context.resume();
    const primed = clips.map((clip) => {
      let source = nodes.get(clip.video);
      if (!source) {
        source = context.createMediaElementSource(clip.video);
        nodes.set(clip.video, source);
      }
      const gain = context.createGain();
      gain.gain.value = 0;
      source.connect(gain);
      gain.connect(destination);
      gains.push(gain);
      clip.video.muted = false;
      return clip.video.play();
    });
    await Promise.all([resumed, ...primed]);
    clips.forEach((c) => c.video.pause());
    await Promise.all(clips.map((c, i) => seek(c.video, plan.starts[i])));
    if (signal.aborted) throw new DOMException('已取消', 'AbortError');
    try {
      wake = await navigator.wakeLock?.request('screen');
    } catch {
      /* Screen wake lock is optional. */
    }
    drawComposition(ctx, clips, boxes, width, height, 0, plan.remaining, order);
    stream = canvas.captureStream(30);
    for (const track of destination.stream.getAudioTracks())
      stream.addTrack(track);
    recorder = new MediaRecorder(stream, {
      mimeType: mime,
      videoBitsPerSecond: 4_000_000,
      audioBitsPerSecond: 128_000,
    });
    const chunks: BlobPart[] = [];
    recorder.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    const finished = new Promise<Blob>((resolve, reject) => {
      recorder!.onstop = () =>
        resolve(new Blob(chunks, { type: recorder!.mimeType }));
      recorder!.onerror = () =>
        reject(new Error('影片編碼失敗，請嘗試較短的影片。'));
    });
    // Attach an early rejection handler while frames are still being rendered.
    void finished.catch(() => {});
    const master = plan.remaining[0] >= plan.remaining[1] ? 0 : 1;
    await Promise.all(clips.map((c) => c.video.play()));
    gains[audio].gain.value = 1;
    recorder.start(1000);
    await new Promise<void>((resolve, reject) => {
      let raf = 0,
        ended = false,
        lastAdvance = performance.now(),
        lastTime = -1;
      const clean = () => {
        ended = true;
        cancelAnimationFrame(raf);
        clearTimeout(deadline);
        signal.removeEventListener('abort', abort);
        document.removeEventListener('visibilitychange', visibility);
      };
      const fail = (error: Error) => {
        if (ended) return;
        clean();
        reject(error);
      };
      const abort = () => fail(new DOMException('已取消', 'AbortError'));
      const visibility = () => {
        if (document.hidden)
          fail(new Error('輸出已中止：請保持 Safari 在前景並重新融合。'));
      };
      const deadline = setTimeout(
        () => fail(new Error('播放中斷，請重新融合並保持畫面開啟。')),
        (plan.duration + 25) * 1000,
      );
      signal.addEventListener('abort', abort, { once: true });
      document.addEventListener('visibilitychange', visibility);
      function frame() {
        if (ended) return;
        if (signal.aborted) return abort();
        const elapsed = Math.max(
          0,
          clips[master].video.currentTime - plan.starts[master],
        );
        if (elapsed > lastTime + 0.005) {
          lastAdvance = performance.now();
          lastTime = elapsed;
        } else if (performance.now() - lastAdvance > 1800)
          return fail(new Error('影片播放停頓，請降低影片解析度後重試。'));
        const other = 1 - master;
        if (elapsed < plan.remaining[other] - 0.12) {
          const drift =
            clips[other].video.currentTime - plan.starts[other] - elapsed;
          if (Math.abs(drift) > 0.25)
            return fail(new Error('裝置播放速度不足，請改用較低解析度影片。'));
          clips[other].video.playbackRate =
            Math.abs(drift) > 0.035 ? (drift > 0 ? 0.96 : 1.04) : 1;
        }
        drawComposition(
          ctx,
          clips,
          boxes,
          width,
          height,
          elapsed,
          plan.remaining,
          order,
        );
        onProgress(Math.min(1, elapsed / plan.duration));
        if (clips[master].video.ended || elapsed >= plan.duration - 0.015) {
          clean();
          resolve();
        } else raf = requestAnimationFrame(frame);
      }
      frame();
    });
    gains.forEach((g) => (g.gain.value = 0));
    recorder.stop();
    const blob = await finished;
    if (blob.size < 1000) throw new Error('沒有產生有效的影片，請重試。');
    return blob;
  } finally {
    if (recorder && recorder.state !== 'inactive') recorder.stop();
    stream?.getTracks().forEach((t) => t.stop());
    destination.stream.getTracks().forEach((t) => t.stop());
    gains.forEach((g, i) => {
      nodes.get(clips[i].video)?.disconnect(g);
      g.disconnect();
    });
    clips.forEach((c) => {
      c.video.pause();
      c.video.muted = true;
      c.video.playbackRate = 1;
    });
    await wake?.release().catch(() => {});
  }
}
