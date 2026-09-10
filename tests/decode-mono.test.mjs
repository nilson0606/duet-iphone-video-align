import assert from 'node:assert/strict';
import test from 'node:test';
import { decodeMono } from '../lib/decode-mono.ts';

function decoder(t, factory) {
  const original = Object.getOwnPropertyDescriptor(
    globalThis,
    'OfflineAudioContext',
  );
  Object.defineProperty(globalThis, 'OfflineAudioContext', {
    configurable: true,
    value: factory,
  });
  t.after(() => {
    if (original)
      Object.defineProperty(globalThis, 'OfflineAudioContext', original);
    else delete globalThis.OfflineAudioContext;
  });
}
const file = () => new File([new Uint8Array([1, 2, 3])], 'clip.mov');

test('audio analysis uses offline decoding and mixes channels without playback or rendering', async (t) => {
  decoder(
    t,
    class {
      constructor(channels, length, rate) {
        assert.equal(rate, 16000);
        assert.equal(length, 1);
      }
      async decodeAudioData(bytes) {
        assert.equal(bytes.byteLength, 3);
        return {
          length: 3,
          numberOfChannels: 2,
          getChannelData: (channel) =>
            Float32Array.from(channel ? [0.3, -0.1, 0.2] : [0.1, 0.3, 0.4]),
        };
      }
    },
  );
  const result = await decodeMono(file(), 16000);
  for (const [i, expected] of [0.2, 0.1, 0.3].entries())
    assert.ok(Math.abs(result[i] - expected) < 1e-6);
});

test('file read errors are distinguished from codec failures', async () => {
  await assert.rejects(
    decodeMono(
      {
        arrayBuffer: async () => {
          throw new Error('file unavailable');
        },
      },
      16000,
    ),
    /檔案讀取失敗.*file unavailable/,
  );
});

test('Safari decoder error name and reason survive for diagnosis', async (t) => {
  decoder(
    t,
    class {
      async decodeAudioData() {
        throw new DOMException('Unable to decode audio data', 'EncodingError');
      }
    },
  );
  await assert.rejects(
    decodeMono(file(), 16000),
    /音軌.*EncodingError: Unable to decode audio data/,
  );
});

test('unsupported analysis context is distinguished from decoding', async (t) => {
  decoder(
    t,
    class {
      constructor() {
        throw new DOMException('sample rate', 'NotSupportedError');
      }
    },
  );
  await assert.rejects(
    decodeMono(file(), 16000),
    /分析功能無法啟動.*NotSupportedError/,
  );
});

test('empty decoded tracks are reported clearly', async (t) => {
  decoder(
    t,
    class {
      async decodeAudioData() {
        return { length: 0, numberOfChannels: 0 };
      }
    },
  );
  await assert.rejects(decodeMono(file(), 16000), /沒有可讀取的音軌/);
});
