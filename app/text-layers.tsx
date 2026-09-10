'use client';
import { useEffect, useRef, useState } from 'react';
import {
  drawTextLayers,
  type TextBounds,
  type TextLayer,
} from '../lib/text-overlay';
import { clamp } from '../lib/timeline.mjs';
const textColors = [
  ['白色', '#ffffff'],
  ['黑色', '#000000'],
  ['紅色', '#ff4d4f'],
  ['黃色', '#ffdf00'],
  ['綠色', '#49d17d'],
  ['藍色', '#4da6ff'],
  ['紫色', '#b388ff'],
  ['粉紅', '#ff80bf'],
] as const;
type Props = {
  layers: TextLayer[];
  selected: string | null;
  disabled: boolean;
  onSelect: (id: string | null) => void;
  onChange: (layers: TextLayer[]) => void;
};
export function TextOverlay({
  layers,
  selected,
  disabled,
  onSelect,
  onChange,
  width,
  height,
}: Props & { width: number; height: number }) {
  const canvas = useRef<HTMLCanvasElement>(null);
  const [bounds, setBounds] = useState<TextBounds[]>([]);
  useEffect(() => {
    const ctx = canvas.current?.getContext('2d');
    if (!ctx) return;
    ctx.clearRect(0, 0, width, height);
    setBounds(drawTextLayers(ctx, layers, width, height));
  }, [layers, width, height]);
  function drag(
    e: React.PointerEvent,
    layer: TextLayer,
    box: TextBounds,
    resize = false,
  ) {
    if (disabled) return;
    e.preventDefault();
    e.stopPropagation();
    onSelect(layer.id);
    const el = e.currentTarget as HTMLElement,
      pointer = e.pointerId;
    const rect = canvas.current!.getBoundingClientRect(),
      x = e.clientX,
      y = e.clientY;
    el.setPointerCapture(pointer);
    const move = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      const dx = (ev.clientX - x) / rect.width,
        dy = (ev.clientY - y) / rect.height;
      const factor =
        1 +
        (dx * box.width + dy * box.height) / (box.width ** 2 + box.height ** 2);
      const next = resize
        ? { ...layer, size: clamp(layer.size * factor, 0.02, 0.25) }
        : {
            ...layer,
            x: clamp(layer.x + dx, -box.width + 0.02, 0.98),
            y: clamp(layer.y + dy, -box.height + 0.02, 0.98),
          };
      onChange(layers.map((item) => (item.id === layer.id ? next : item)));
    };
    const end = (ev: PointerEvent) => {
      if (ev.pointerId !== pointer) return;
      el.removeEventListener('pointermove', move);
      el.removeEventListener('pointerup', end);
      el.removeEventListener('pointercancel', end);
      el.removeEventListener('lostpointercapture', end);
      if (el.hasPointerCapture(pointer)) el.releasePointerCapture(pointer);
    };
    el.addEventListener('pointermove', move);
    el.addEventListener('pointerup', end);
    el.addEventListener('pointercancel', end);
    el.addEventListener('lostpointercapture', end);
  }
  return (
    <>
      <canvas
        ref={canvas}
        width={width}
        height={height}
        className="text-preview"
        aria-hidden="true"
      />
      {bounds.map((box) => {
        const layer = layers.find((item) => item.id === box.id);
        if (!layer) return null;
        return (
          <button
            key={box.id}
            type="button"
            disabled={disabled}
            className={`text-hit ${selected === box.id ? 'active' : ''}`}
            style={{
              left: `${box.x * 100}%`,
              top: `${box.y * 100}%`,
              width: `${box.width * 100}%`,
              height: `${box.height * 100}%`,
            }}
            aria-label={`文字：${layer.text || '空白'}，方向鍵移動`}
            onFocus={() => onSelect(box.id)}
            onPointerDown={(e) => drag(e, layer, box)}
            onKeyDown={(e) => {
              const step = e.shiftKey ? 0.03 : 0.005;
              const dirs: Record<string, number[]> = {
                ArrowLeft: [-step, 0],
                ArrowRight: [step, 0],
                ArrowUp: [0, -step],
                ArrowDown: [0, step],
              };
              const d = dirs[e.key];
              if (d) {
                e.preventDefault();
                onChange(
                  layers.map((t) =>
                    t.id === layer.id
                      ? {
                          ...t,
                          x: clamp(t.x + d[0], -box.width + 0.02, 0.98),
                          y: clamp(t.y + d[1], -box.height + 0.02, 0.98),
                        }
                      : t,
                  ),
                );
              }
            }}
          >
            {selected === box.id && (
              <span
                className="text-resize"
                aria-hidden="true"
                onPointerDown={(e) => drag(e, layer, box, true)}
              >
                ↘
              </span>
            )}
          </button>
        );
      })}
    </>
  );
}
export function TextControls({
  layers,
  selected,
  disabled,
  onSelect,
  onChange,
}: Props) {
  const active = layers.find((t) => t.id === selected);
  function remove(id: string) {
    if (disabled) return;
    const remaining = layers.filter((layer) => layer.id !== id);
    onChange(remaining);
    if (selected === id) onSelect(remaining[0]?.id ?? null);
  }
  const edit = (patch: Partial<TextLayer>) =>
    onChange(layers.map((t) => (t.id === selected ? { ...t, ...patch } : t)));
  return (
    <section className="text-controls" aria-label="文字疊加">
      <div className="text-heading">
        <b>疊加文字</b>
        <button
          type="button"
          disabled={disabled || layers.length >= 8}
          onClick={() => {
            const id = crypto.randomUUID();
            onChange([
              ...layers,
              {
                id,
                text: '輸入文字',
                x: 0.08,
                y: 0.08 + layers.length * 0.06,
                size: 0.065,
                color: '#ffffff',
              },
            ]);
            onSelect(id);
          }}
        >
          ＋ 新增文字
        </button>
      </div>
      <p className="hint">
        文字會顯示整段影片。拖動文字移位置，拉右下角縮放，也可用下方滑桿調整。
      </p>
      {!!layers.length && (
        <div className="text-tabs">
          {layers.map((t, i) => (
            <div className="text-tab" key={t.id}>
              <button
                type="button"
                disabled={disabled}
                aria-pressed={selected === t.id}
                onClick={() => onSelect(t.id)}
              >
                文字 {i + 1}
              </button>
              <button
                type="button"
                className="text-delete"
                disabled={disabled}
                aria-label={`刪除文字 ${i + 1}`}
                onClick={() => remove(t.id)}
              >
                刪除
              </button>
            </div>
          ))}
        </div>
      )}
      {!!layers.length && !active && (
        <p className="hint">選取上方的文字項目，即可修改內容、大小與顏色。</p>
      )}
      {active && (
        <div className="text-settings">
          <label className="text-content">
            文字內容
            <textarea
              rows={2}
              maxLength={80}
              value={active.text}
              disabled={disabled}
              onChange={(e) => edit({ text: e.target.value })}
              placeholder="輸入要疊加的文字，可換行"
            />
          </label>
          <label className="text-size">
            文字大小 <output>{Math.round(active.size * 100)}%</output>
            <input
              type="range"
              min="2"
              max="25"
              step="0.5"
              value={active.size * 100}
              disabled={disabled}
              onChange={(e) => edit({ size: Number(e.target.value) / 100 })}
            />
          </label>
          <fieldset className="text-color-options" disabled={disabled}>
            <legend>文字顏色</legend>
            <div className="text-colors">
              {textColors.map(([name, color]) => (
                <button
                  type="button"
                  key={color}
                  aria-label={`文字顏色：${name}`}
                  aria-pressed={active.color.toLowerCase() === color}
                  onClick={() => edit({ color })}
                >
                  <span aria-hidden="true" style={{ backgroundColor: color }} />
                  {name}
                </button>
              ))}
            </div>
            <label className="text-custom-color">
              自訂顏色
              <input
                type="color"
                value={active.color}
                disabled={disabled}
                onChange={(e) => edit({ color: e.target.value })}
              />
            </label>
          </fieldset>
        </div>
      )}
    </section>
  );
}
