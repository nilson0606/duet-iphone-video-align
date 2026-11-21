import {
  Input,
  BlobSource,
  ALL_FORMATS,
  Output,
  BufferTarget,
  Mp4OutputFormat,
  Conversion,
} from 'mediabunny';
import { normalizationPlan } from '../lib/normalize-policy.mjs';

self.onmessage = async ({
  data,
}: MessageEvent<{ file: File; mode: string }>) => {
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
    const [codec, width, height, metrics] = await Promise.all([
      track.getCodec(),
      track.getDisplayWidth(),
      track.getDisplayHeight(),
      track.computeFrameRateMetrics({ targetPacketCount: 512 }),
    ]);
    const plan = normalizationPlan({
      codec,
      width,
      height,
      fps: metrics.bestGuessFrameRate,
      constant: metrics.frameRateIsConstant,
    });
    const description = `${codec ?? '未知編碼'} · ${width}×${height} · 約 ${metrics.averageFrameRate.toFixed(1)} fps（取樣檢查）`;
    if (data.mode !== 'always' && !plan.reasons.length) {
      self.postMessage({ type: 'done', note: description + '；沿用原片。' });
      return;
    }
    self.postMessage({
      type: 'progress',
      progress: 0,
      note: plan.reasons.join('、') || '指定轉換',
    });
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
        width: plan.width,
        height: plan.height,
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
    self.postMessage({
      type: 'done',
      file,
      note:
        description +
        ` → H.264／AAC · ${plan.width}×${plan.height} · 固定 30 fps`,
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
