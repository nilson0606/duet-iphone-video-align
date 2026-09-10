import { timeline } from './timeline.mjs';
import {
  drawComposition,
  seek,
  supportedMime,
  type Clip,
  type Box,
} from './media.ts';
import { mediaDeadline, abortReason } from './media-deadline.ts';
export type ExportPhase =
  | 'preparing'
  | 'recording'
  | 'finalizing'
  | 'done'
  | 'error'
  | 'cancelled';
export async function renderMovie(args: {
  clips: Clip[];
  boxes: Box[];
  order: number[];
  offset: number;
  width: number;
  height: number;
  audio: number;
  context: AudioContext;
  canvas: HTMLCanvasElement;
  sourceHost: HTMLElement;
  signal: AbortSignal;
  onProgress: (n: number) => void;
  onStage: (phase: ExportPhase, message: string) => void;
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
    canvas,
    sourceHost,
    signal,
    onProgress,
    onStage,
  } = args;
  const plan = timeline(clips[0].duration, clips[1].duration, offset);
  const session = new AbortController();
  const cancel = () => session.abort(abortReason(signal));
  signal.addEventListener('abort', cancel, { once: true });
  if (signal.aborted) cancel();
  const visibility = () => {
    if (document.hidden)
      session.abort(
        new Error('輸出已中止：請保持網站在前景，勿鎖定螢幕。（E01）'),
      );
  };
  document.addEventListener('visibilitychange', visibility);
  const run = <T>(promise: Promise<T>, ms: number, message: string) =>
    mediaDeadline(promise, session.signal, ms, message);
  const parents = clips.map((c) => c.video.parentNode);
  let stream: MediaStream | undefined,
    destination: MediaStreamAudioDestinationNode | undefined;
  let recorder: MediaRecorder | undefined,
    source: AudioBufferSourceNode | undefined;
  let wake: WakeLockSentinel | undefined,
    stopping = false;
  try {
    onStage('preparing', '正在啟動影片與音訊…');
    onProgress(0);
    if (session.signal.aborted) throw abortReason(session.signal);
    const mime = supportedMime();
    if (!mime)
      throw new Error('此瀏覽器不支援影片輸出，請使用最新版 Safari。（E02）');
    canvas.width = width;
    canvas.height = height;
    const ctx = canvas.getContext('2d')!;
    if (!ctx || !canvas.captureStream)
      throw new Error('此瀏覽器無法錄製合成畫面。（E03）');
    // Keep both decoders muted and visible. Safari can interrupt competing
    // unmuted media elements. The selected audio is rendered separately below.
    const resumed = context.resume();
    const primed = clips.map((c) => {
      c.video.muted = true;
      c.video.playsInline = true;
      c.video.playbackRate = 1;
      sourceHost.appendChild(c.video);
      return c.video.play();
    });
    await run(
      Promise.all([resumed, ...primed]),
      12000,
      '影片尚未開始播放。請在 Safari 開啟同一網址後重試。（E04）',
    );
    clips.forEach((c) => c.video.pause());
    onStage('preparing', '正在準備選定的音軌…');
    const audioBytes = await run(
      clips[audio].file.arrayBuffer(),
      20000,
      '讀取音軌逾時，請重新選擇影片。（E05）',
    );
    const buffer = await run(
      context.decodeAudioData(audioBytes),
      30000,
      '音軌解碼逾時，請嘗試較短的影片。（E06）',
    );
    onStage('preparing', '正在定位兩部影片的同步起點…');
    await run(
      Promise.all(
        clips.map((c, i) => seek(c.video, plan.starts[i], session.signal)),
      ),
      15000,
      '影片定位逾時，請重試。（E07）',
    );
    drawComposition(ctx, clips, boxes, width, height, 0, plan.remaining, order);
    // A wake-lock prompt must never delay the recording startup.
    void navigator.wakeLock
      ?.request('screen')
      .then((lock) => {
        if (session.signal.aborted || stopping)
          void lock.release().catch(() => {});
        else wake = lock;
      })
      .catch(() => {});
    destination = context.createMediaStreamDestination();
    source = context.createBufferSource();
    source.buffer = buffer;
    source.connect(destination);
    stream = canvas.captureStream(30);
    destination.stream
      .getAudioTracks()
      .forEach((track) => stream!.addTrack(track));
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
      recorder!.onstop = () => {
        if (!stopping)
          session.abort(new Error('瀏覽器提前停止錄製，請重試。（E08）'));
        resolve(new Blob(chunks, { type: recorder!.mimeType }));
      };
      recorder!.onerror = () => {
        const error = new Error('影片編碼失敗，請改用較短的影片。（E09）');
        session.abort(error);
        reject(error);
      };
    });
    void finished.catch(() => {});
    await run(
      Promise.all(clips.map((c) => c.video.play())),
      12000,
      '同步播放尚未啟動，請重新融合。（E10）',
    );
    // The audio buffer is the master clock; neither video controls the output
    // duration. Correct decoder drift instead of failing at a 250 ms difference.
    const startClock = context.currentTime;
    recorder.start(1000);
    const audioStart = plan.starts[audio];
    if (audioStart < buffer.duration)
      source.start(
        startClock,
        audioStart,
        Math.min(buffer.duration - audioStart, plan.remaining[audio]),
      );
    onStage('recording', '正在融合；請保持畫面開啟。');
    await new Promise<void>((resolve, reject) => {
      let raf = 0,
        settled = false,
        lastReport = -1;
      const correcting = [false, false],
        badSince: (number | null)[] = [null, null];
      const cleanup = () => {
        settled = true;
        cancelAnimationFrame(raf);
        clearTimeout(timer);
        session.signal.removeEventListener('abort', abort);
      };
      const fail = (error: Error) => {
        if (settled) return;
        cleanup();
        reject(error);
      };
      const abort = () => fail(abortReason(session.signal));
      const timer = setTimeout(
        () => fail(new Error('輸出逾時，請重試。（E11）')),
        (plan.duration + 20) * 1000,
      );
      session.signal.addEventListener('abort', abort, { once: true });
      function frame() {
        if (settled) return;
        if (session.signal.aborted) return abort();
        const elapsed = Math.max(0, context.currentTime - startClock);
        if (elapsed >= plan.duration) {
          cleanup();
          resolve();
          return;
        }
        for (let i = 0; i < clips.length; i++) {
          const video = clips[i].video;
          if (elapsed >= plan.remaining[i]) {
            video.pause();
            continue;
          }
          const target = plan.starts[i] + elapsed,
            drift = video.currentTime - target;
          if (Math.abs(drift) > 0.3) {
            badSince[i] ??= performance.now();
          } else badSince[i] = null;
          if (badSince[i] !== null && performance.now() - badSince[i]! > 8000)
            return fail(
              new Error(
                `影片 ${i === 0 ? 'A' : 'B'} 持續無法恢復同步，請返回調整並選「省電 480p」重試。（E12）`,
              ),
            );
          if (!correcting[i] && (Math.abs(drift) > 0.18 || video.paused)) {
            correcting[i] = true;
            void seek(
              video,
              Math.min(target + 0.04, clips[i].duration - 0.04),
              session.signal,
            )
              .then(() =>
                run(video.play(), 6000, '影片同步播放未回應，請重試。（E13）'),
              )
              .then(() => {
                correcting[i] = false;
              })
              .catch((error) => {
                correcting[i] = false;
                if (!settled)
                  fail(
                    error instanceof Error
                      ? error
                      : new Error('影片同步中斷。（E13）'),
                  );
              });
          } else if (!correcting[i])
            video.playbackRate =
              Math.abs(drift) > 0.025 ? (drift > 0 ? 0.94 : 1.06) : 1;
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
        if (elapsed - lastReport >= 0.1) {
          onProgress(Math.min(0.99, elapsed / plan.duration));
          lastReport = elapsed;
        }
        raf = requestAnimationFrame(frame);
      }
      frame();
    });
    onStage('finalizing', '正在完成影片檔案…');
    onProgress(0.99);
    stopping = true;
    recorder.stop();
    const blob = await run(
      finished,
      15000,
      '影片封裝逾時，請重新融合。（E14）',
    );
    if (blob.size < 1000) throw new Error('沒有產生有效影片，請重試。（E15）');
    onProgress(1);
    return blob;
  } catch (error) {
    if (session.signal.aborted) throw abortReason(session.signal);
    throw error;
  } finally {
    stopping = true;
    session.abort();
    signal.removeEventListener('abort', cancel);
    document.removeEventListener('visibilitychange', visibility);
    try {
      if (recorder && recorder.state !== 'inactive') recorder.stop();
    } catch {
      /* Best-effort cleanup. */
    }
    try {
      source?.stop();
    } catch {
      /* Source may not have started. */
    }
    source?.disconnect();
    destination?.disconnect();
    stream?.getTracks().forEach((t) => t.stop());
    destination?.stream.getTracks().forEach((t) => t.stop());
    clips.forEach((c, i) => {
      c.video.pause();
      c.video.muted = true;
      c.video.playbackRate = 1;
      if (parents[i]) parents[i]!.appendChild(c.video);
    });
    void wake?.release().catch(() => {});
  }
}
