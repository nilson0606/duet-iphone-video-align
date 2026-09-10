import assert from 'node:assert/strict';
import test from 'node:test';
import { drawTextLayers } from '../lib/text-overlay.ts';
function context() {
  return {
    font: '',
    calls: [],
    save() {},
    restore() {},
    measureText(text) {
      return {
        width:
          Array.from(text).length *
          Number(this.font.match(/[\d.]+(?=px)/)[0]) *
          0.6,
      };
    },
    strokeText(text, x, y) {
      this.calls.push(['outline', text, x, y]);
    },
    fillText(text, x, y) {
      this.calls.push(['fill', text, x, y]);
    },
  };
}
test('text placement, line breaks and size scale consistently across export resolutions', () => {
  const layer = {
    id: 'a',
    text: '合拍\nDUET',
    x: 0.2,
    y: 0.3,
    size: 0.06,
    color: '#ffffff',
  };
  const small = context(),
    large = context();
  const a = drawTextLayers(small, [layer], 1280, 720)[0];
  const b = drawTextLayers(large, [layer], 1920, 1080)[0];
  for (const key of ['x', 'y', 'width', 'height'])
    assert.ok(Math.abs(a[key] - b[key]) < 1e-10);
  assert.deepEqual(
    small.calls.filter((c) => c[0] === 'fill').map((c) => c[1]),
    ['合拍', 'DUET'],
  );
  for (let i = 0; i < small.calls.length; i++) {
    assert.ok(Math.abs(large.calls[i][2] - small.calls[i][2] * 1.5) < 1e-8);
    assert.ok(Math.abs(large.calls[i][3] - small.calls[i][3] * 1.5) < 1e-8);
  }
});
test('long text wraps within the composition and leaves later layers above earlier text', () => {
  const ctx = context();
  const first = {
    id: 'a',
    text: '字幕'.repeat(40),
    x: 0,
    y: 0,
    size: 0.25,
    color: '#ffffff',
  };
  const boxes = drawTextLayers(
    ctx,
    [first, { ...first, id: 'b', text: '上層', color: '#ff0000' }],
    720,
    1280,
  );
  assert.ok(boxes[0].width <= 0.9 + 1e-10);
  assert.equal(
    ctx.calls
      .filter((c) => c[0] === 'fill')
      .map((c) => c[1])
      .join(''),
    first.text + '上層',
  );
  assert.equal(ctx.calls.at(-1)[1], '上層');
});
