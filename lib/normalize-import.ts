import { abortReason } from './media-deadline.ts';

export type ImportMode = 'auto' | 'always' | 'original';
export function normalizeImport(
  file: File,
  mode: ImportMode,
  signal: AbortSignal,
  createWorker: () => Worker,
  onProgress: (message: string) => void,
): Promise<{ file: File; note: string; converted: boolean }> {
  if (signal.aborted) return Promise.reject(abortReason(signal));
  if (file.size > 250 * 1024 * 1024)
    return Promise.reject(new Error('每部影片上限 250 MB。'));
  if (mode === 'original')
    return Promise.resolve({ file, note: '直接使用原片', converted: false });
  return new Promise((resolve, reject) => {
    let worker: Worker | undefined;
    let idle: ReturnType<typeof setTimeout>;
    let settled = false;
    const finish = (
      error?: Error,
      result?: { file: File; note: string; converted: boolean },
    ) => {
      if (settled) return;
      settled = true;
      clearTimeout(idle);
      clearTimeout(total);
      signal.removeEventListener('abort', abort);
      document.removeEventListener('visibilitychange', hidden);
      worker?.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(abortReason(signal));
    const hidden = () => {
      if (document.hidden)
        finish(new Error('已中止格式轉換，請保持網頁在前景並重新匯入。'));
    };
    const timeout = () =>
      finish(
        new Error('格式檢查或轉換逾時。請縮短影片後重試，或選擇直接使用原片。'),
      );
    const resetIdle = () => {
      clearTimeout(idle);
      idle = setTimeout(timeout, 60000);
    };
    const total = setTimeout(timeout, 20 * 60 * 1000);
    signal.addEventListener('abort', abort, { once: true });
    document.addEventListener('visibilitychange', hidden);
    try {
      worker = createWorker();
      worker.onerror = () =>
        finish(new Error('轉換工具啟動失敗，請重新整理後重試。'));
      worker.onmessageerror = () =>
        finish(new Error('轉換結果讀取失敗，請重試。'));
      worker.onmessage = ({ data }) => {
        if (settled) return;
        if (data.type === 'progress') {
          resetIdle();
          onProgress(
            `格式轉換 ${Math.round(data.progress * 100)}%${data.note ? ' · ' + data.note : ''}…`,
          );
        } else if (data.type === 'done') {
          finish(undefined, {
            file: data.file ?? file,
            note: data.note,
            converted: !!data.file,
          });
        } else if (data.type === 'error') finish(new Error(data.message));
      };
      resetIdle();
      worker.postMessage({ file, mode });
      if (signal.aborted) abort();
      hidden();
    } catch (error) {
      finish(error instanceof Error ? error : new Error('格式檢查失敗。'));
    }
  });
}
