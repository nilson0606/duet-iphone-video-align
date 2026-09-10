import assert from 'node:assert/strict';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { fft, fingerprints, alignFeatures } from '../lib/alignment.mjs';
import { timeline, isClipActive } from '../lib/timeline.mjs';
import { drawComposition } from '../lib/media.ts';
const decode = (path) => {
  const bytes = execFileSync(
    'ffmpeg',
    ['-v', 'error', '-i', path, '-f', 'f32le', '-ac', '1', '-ar', '16000', '-'],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return new Float32Array(
    bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength),
  );
};
const a = fingerprints(decode('public/demo/camera-a.mp4'), 16000),
  b = fingerprints(decode('public/demo/camera-b.mp4'), 16000);
test('AAC encoded videos with independent noise align within one video frame', () => {
  const r = alignFeatures(a, b);
  assert.ok(Math.abs(r.offset - 2.34) < 1 / 30, JSON.stringify(r));
  assert.ok(r.confident, JSON.stringify(r));
  console.log('Measured noisy AAC alignment:', r);
});
test('reversing sources reverses the time offset', () => {
  const r = alignFeatures(b, a);
  assert.ok(Math.abs(r.offset + 2.34) < 1 / 30, JSON.stringify(r));
  assert.ok(r.confident);
});
test('identical clips align to zero', () => {
  const r = alignFeatures(a, a);
  assert.equal(r.offset, 0);
  assert.ok(r.confident);
});
test('silence is never confidently aligned', () => {
  const z = new Float32Array(16000 * 8);
  assert.equal(
    alignFeatures(fingerprints(z, 16000), fingerprints(z, 16000)).confident,
    false,
  );
});
test('unrelated random audio is not confidently aligned', () => {
  let seed = 321;
  const rand = () => {
    seed = (seed * 1664525 + 1013904223) >>> 0;
    return (seed / 4294967296) * 2 - 1;
  };
  const x = Float32Array.from({ length: 16000 * 15 }, rand),
    y = Float32Array.from({ length: 16000 * 17 }, rand);
  assert.equal(
    alignFeatures(fingerprints(x, 16000), fingerprints(y, 16000)).confident,
    false,
  );
});
test('keep all of longer tail and black the finished clip', () => {
  const p = timeline(22, 14, 2.34);
  assert.deepEqual(p.starts, [2.34, 0]);
  assert.equal(p.duration, 19.66);
  assert.equal(p.remaining[1], 14);
  assert.equal(isClipActive(14, p.remaining[1]), false);
  assert.equal(isClipActive(14, p.remaining[0]), true);
});
test('negative offsets trim B, and invalid offsets reject', () => {
  assert.deepEqual(timeline(14, 22, -2.34).starts, [0, 2.34]);
  assert.throws(() => timeline(10, 10, 10));
  assert.throws(() => timeline(10, 10, NaN));
  assert.throws(() => timeline(0, 10, 0));
});
test('compositor explicitly paints expired overlay black, preserving geometry', () => {
  const ops = [];
  const ctx = {
    fillStyle: '',
    fillRect: (...args) => ops.push(['black', ...args]),
    drawImage: (...args) => ops.push(['video', ...args]),
  };
  const clips = [{ video: 'A' }, { video: 'B' }],
    boxes = [
      { x: 0, y: 0, width: 1, height: 1 },
      { x: 0.6, y: 0.6, width: 0.3, height: 0.3 },
    ];
  drawComposition(ctx, clips, boxes, 1000, 1000, 15, [20, 14], [0, 1]);
  assert.deepEqual(ops, [
    ['black', 0, 0, 1000, 1000],
    ['video', 'A', 0, 0, 1000, 1000],
    ['black', 600, 600, 300, 300],
  ]);
});
test('both videos render before shorter source ends', () => {
  const ops = [];
  const ctx = {
    fillStyle: '',
    fillRect: () => {},
    drawImage: (v) => ops.push(v),
  };
  drawComposition(
    ctx,
    [{ video: 'A' }, { video: 'B' }],
    [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    1280,
    720,
    13.9,
    [19.66, 14],
    [1, 0],
  );
  assert.deepEqual(ops, ['B', 'A']);
});
test('FFT inverse preserves signal', () => {
  const r = Float64Array.from([1, 0, 3, -1, 0, 0, 0, 0]),
    i = new Float64Array(8);
  fft(r, i);
  fft(r, i, true);
  assert.ok(Math.abs(r[2] - 3) < 1e-9);
  assert.ok(Math.abs(r[3] + 1) < 1e-9);
});
