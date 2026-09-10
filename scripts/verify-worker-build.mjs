import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { execFileSync } from 'node:child_process';
const publicRoot = 'dist/client';
const chunks = 'dist/client/_next/static/chunks';
const pages = fs.readdirSync(chunks).filter((f) => /^page-.*\.js$/.test(f));
assert.ok(pages.length, 'Build first');
const source = pages
  .map((f) => fs.readFileSync(path.join(chunks, f), 'utf8'))
  .join('\n');
assert.ok(
  /new Worker\(new URL\([^,]+,window\.location\.href\)/.test(source),
  'Worker must resolve against the browser URL',
);
assert.ok(
  !/new Worker\(new URL\([^)]*file:/.test(source),
  'Worker must not use the server file: URL',
);
const matches = source.match(/\/_next\/static\/align\.worker-[\w-]+\.js/g);
assert.ok(
  matches?.length,
  'Worker URL must be emitted into the browser bundle',
);
const workerPath = matches[0];
assert.equal(new URL(workerPath, 'https://example.com/').protocol, 'https:');
const compiled = fs.readFileSync(path.join(publicRoot, workerPath), 'utf8');
const decode = (filename) => {
  const data = execFileSync(
    'ffmpeg',
    [
      '-v',
      'error',
      '-i',
      filename,
      '-f',
      'f32le',
      '-ac',
      '1',
      '-ar',
      '16000',
      '-',
    ],
    { maxBuffer: 32 * 1024 * 1024 },
  );
  return new Float32Array(
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
};
let reply;
const self = {
  postMessage(data) {
    reply = data;
  },
};
vm.runInNewContext(compiled, { self }, { timeout: 5000 });
assert.equal(typeof self.onmessage, 'function');
self.onmessage({
  data: {
    a: decode(process.argv[2] ?? 'public/demo/camera-a.mp4'),
    b: decode(process.argv[3] ?? 'public/demo/camera-b.mp4'),
    rate: 16000,
  },
});
assert.equal(reply?.error, undefined);
assert.ok(
  Math.abs(reply.result.offset - Number(process.argv[4] ?? 2.34)) < 0.04,
);
assert.equal(reply.result.confident, true);
console.log(
  'Production Worker URL and compiled message handler passed; noisy AAC offset:',
  reply.result.offset,
);

const a = decode('public/demo/camera-a.mp4');
const b = decode('public/demo/camera-b.mp4');
for (const matchSeconds of [0, 1, 2, 3, 4, 5]) {
  self.onmessage({ data: { a, b, rate: 16000, matchSeconds } });
  assert.equal(reply?.error, undefined);
  assert.ok(Math.abs(reply.result.offset - 2.34) < 0.04);
  assert.equal(reply.result.confident, true);
}
console.log('Compiled worker passed all six matching-duration options.');

const captureProcessor = fs.readFileSync(
  path.join(publicRoot, 'audio-capture.worklet.js'),
  'utf8',
);
let registered;
vm.runInNewContext(captureProcessor, {
  AudioWorkletProcessor: class {},
  registerProcessor(name, ctor) {
    registered = { name, ctor };
  },
});
assert.equal(registered.name, 'duet-audio-capture');
assert.equal(typeof registered.ctor, 'function');
assert.ok(
  source.includes('/audio-capture.worklet.js'),
  'The player capture module must be reachable from the client',
);
assert.ok(
  !source.includes('decodeAudioData'),
  'Client must not decode the whole movie file',
);
console.log(
  'Player audio processor is packaged; no whole-movie decode remains in the client.',
);

const mutedA = a.slice(),
  mutedB = b.slice();
mutedA.fill(0, 0, Math.round(0.18 * 16000));
mutedB.fill(0, 0, Math.round(0.12 * 16000));
for (const matchSeconds of [0, 5]) {
  self.onmessage({ data: { a: mutedA, b: mutedB, rate: 16000, matchSeconds } });
  assert.equal(reply?.error, undefined);
  assert.equal(reply.result.confident, true);
  assert.ok(Math.abs(reply.result.offset - 2.34) < 0.04, JSON.stringify(reply));
}
console.log('Compiled worker ignores the false 60 ms startup-silence match.');
