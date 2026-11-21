import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  Conversion,
} from 'mediabunny';
import { decodeAudioTrack } from '../lib/decode-audio-track.ts';

self.onmessage = async ({ data }: MessageEvent<{ file: File }>) => {
  const input = new Input({
    source: new BlobSource(data.file),
    formats: ALL_FORMATS,
  });
  let conversion: Conversion | undefined;
  try {
    const track = await input.getPrimaryVideoTrack();
    if (!track) throw new Error('沒有可讀取的影片軌。');
    const duration = await input.computeDuration();
    if (!Number.isFinite(duration) || duration < 3 || duration > 600)
      throw new Error('支援每部 3 秒至 10 分鐘的影片。');
    const [width, height] = await Promise.all([
      track.getDisplayWidth(),
      track.getDisplayHeight(),
    ]);
    const scale = Math.min(1, 1280 / Math.max(width, height));
    const outputWidth = Math.max(2, Math.floor((width * scale) / 2) * 2);
    const outputHeight = Math.max(2, Math.floor((height * scale) / 2) * 2);
    self.postMessage({ type: 'progress', progress: 0 });
    const target = new BufferTarget();
    const output = new Output({
      format: new Mp4OutputFormat({ fastStart: 'in-memory' }),
      target,
    });
    // Keep the original timeline origin so leading silence and A/V offsets survive.
    conversion = await Conversion.init({
      input,
      output,
      tracks: 'primary',
      trim: { start: 0 },
      video: {
        codec: 'avc',
        width: outputWidth,
        height: outputHeight,
        fit: 'contain',
        frameRate: 30,
        bitrate: 3_000_000,
        forceTranscode: true,
        allowRotationMetadata: false,
      },
      audio: { codec: 'aac' },
      showWarnings: false,
    });
    if (!conversion.isValid || conversion.discardedTracks.length)
      throw new Error(
        '此 Safari 無法完整轉換這支影片的影像或音訊。可更新 iOS，或先用電腦轉為 H.264／AAC、30 fps 再匯入。',
      );
    conversion.onProgress = (progress) =>
      self.postMessage({ type: 'progress', progress });
    await conversion.execute();
    if (!target.buffer || target.buffer.byteLength > 250 * 1024 * 1024)
      throw new Error('轉換後檔案超過 250 MB，請縮短影片。');
    const file = new File(
      [target.buffer],
      data.file.name.replace(/\.[^.]+$/, '') + '_相容30fps.mp4',
      { type: 'video/mp4' },
    );
    // Decode the completed file once, before the editor opens its video players.
    // Preserve its presentation timestamps rather than decoding the original file.
    let mono: Float32Array | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const converted = new Input({
      source: new BlobSource(file),
      formats: ALL_FORMATS,
    });
    try {
      const convertedDuration = await converted.computeDuration();
      self.postMessage({ type: 'progress', progress: 1, note: '準備對齊聲音' });
      mono = await Promise.race([
        decodeAudioTrack(file, convertedDuration, () => {
          self.postMessage({
            type: 'progress',
            progress: 1,
            note: '準備對齊聲音',
          });
        }),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () => reject(new Error('Audio preparation timed out')),
            20000,
          );
        }),
      ]);
    } catch {
      // Older browsers can still use the existing player capture during alignment.
    } finally {
      clearTimeout(timer);
      converted.dispose();
    }
    self.postMessage({
      type: 'done',
      mono,
      file,
      note: `已轉換螢幕錄影 · H.264／AAC · ${outputWidth}×${outputHeight} · 固定 30 fps${mono ? ' · 對齊聲音已備妥' : ''}`,
    });
  } catch (error) {
    self.postMessage({
      type: 'error',
      message: error instanceof Error ? error.message : '格式轉換失敗。',
    });
  } finally {
    if (conversion && conversion.state !== 'done')
      await conversion.cancel().catch(() => {});
    input.dispose();
  }
};
