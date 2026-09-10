import { mediaDeadline } from './media-deadline.ts';

function failure(stage: string, error: unknown): Error {
  const detail =
    error instanceof Error ? `${error.name}: ${error.message}` : String(error);
  return new Error(
    `${stage}（${detail}）。可重新選擇影片重試，或手動設定時間差。`,
  );
}

export async function decodeMono(
  file: File,
  rate: number,
): Promise<Float32Array> {
  const signal = new AbortController().signal;
  let bytes: ArrayBuffer;
  try {
    bytes = await mediaDeadline(
      file.arrayBuffer(),
      signal,
      30000,
      '讀取檔案逾時',
    );
  } catch (error) {
    throw failure('影片檔案讀取失敗', error);
  }
  let context: OfflineAudioContext;
  try {
    // decodeAudioData already resamples to this context's rate. No live audio
    // device, playback permission, or second offline rendering pass is needed.
    context = new OfflineAudioContext(1, 1, rate);
  } catch (error) {
    throw failure('瀏覽器音訊分析功能無法啟動', error);
  }
  let decoded: AudioBuffer;
  try {
    decoded = await mediaDeadline(
      context.decodeAudioData(bytes),
      signal,
      30000,
      '音訊解碼逾時',
    );
  } catch (error) {
    throw failure('瀏覽器無法解碼此影片的音軌', error);
  }
  if (!decoded.numberOfChannels || !decoded.length)
    throw new Error('影片沒有可讀取的音軌，可手動設定時間差。');
  try {
    const mono = new Float32Array(decoded.length);
    for (let channel = 0; channel < decoded.numberOfChannels; channel++) {
      const data = decoded.getChannelData(channel);
      for (let i = 0; i < mono.length; i++)
        mono[i] += data[i] / decoded.numberOfChannels;
    }
    return mono;
  } catch (error) {
    throw failure('音訊分析資料轉換失敗', error);
  }
}
