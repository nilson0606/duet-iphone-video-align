export type TextLayer = {
  id: string;
  text: string;
  x: number;
  y: number;
  size: number;
  color: string;
};
export type TextBounds = {
  id: string;
  x: number;
  y: number;
  width: number;
  height: number;
};
export const TEXT_FONT =
  'Arial, "PingFang TC", "Microsoft JhengHei", sans-serif';
export function drawTextLayers(
  ctx: CanvasRenderingContext2D,
  layers: TextLayer[],
  width: number,
  height: number,
): TextBounds[] {
  ctx.save();
  ctx.textBaseline = 'top';
  ctx.textAlign = 'left';
  ctx.lineJoin = 'round';
  const bounds = layers.map((layer) => {
    const font = Math.min(width, height) * layer.size;
    const pad = font * 0.12,
      lineHeight = font * 1.3;
    ctx.font = `700 ${font}px ${TEXT_FONT}`;
    const lines: string[] = [];
    for (const paragraph of layer.text.replaceAll('\r', '').split('\n')) {
      let line = '';
      for (const char of Array.from(paragraph)) {
        if (
          line &&
          ctx.measureText(line + char).width > width * 0.9 - pad * 2
        ) {
          lines.push(line);
          line = char;
        } else line += char;
      }
      lines.push(line);
    }
    const x = layer.x * width,
      y = layer.y * height;
    ctx.fillStyle = layer.color;
    ctx.strokeStyle = '#000000';
    ctx.lineWidth = font * 0.07;
    for (let i = 0; i < lines.length; i++) {
      ctx.strokeText(lines[i], x + pad, y + pad + i * lineHeight);
      ctx.fillText(lines[i], x + pad, y + pad + i * lineHeight);
    }
    return {
      id: layer.id,
      x: layer.x,
      y: layer.y,
      width:
        (Math.max(
          font * 0.5,
          ...lines.map((line) => ctx.measureText(line).width),
        ) +
          2 * pad) /
        width,
      height: (lines.length * lineHeight + 2 * pad) / height,
    };
  });
  ctx.restore();
  return bounds;
}
export function createTextOverlay(
  layers: TextLayer[],
  width: number,
  height: number,
) {
  if (!layers.length) return null;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('無法準備文字圖層，請重試。');
  drawTextLayers(ctx, layers, width, height);
  return canvas;
}
