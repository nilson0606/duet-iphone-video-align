import assert from 'node:assert/strict';
import test from 'node:test';
import { mediaDeadline } from '../lib/media-deadline.ts';
import { renderMovie } from '../lib/render-movie.ts';

test('pending media operations time out rather than hanging', async () => {
  await assert.rejects(
    mediaDeadline(
      new Promise(() => {}),
      new AbortController().signal,
      15,
      'startup timeout',
    ),
    /startup timeout/,
  );
});
test('cancel interrupts a pending media operation', async () => {
  const abort = new AbortController();
  const work = mediaDeadline(
    new Promise(() => {}),
    abort.signal,
    1000,
    'timeout',
  );
  abort.abort();
  await assert.rejects(work, { name: 'AbortError' });
});

// Exercise the orchestration with real EventTargets and controlled decoder clocks.
// Browser codec/device support is intentionally not claimed by this simulation.
function environment({
  lag = 0,
  playPending = false,
  clockDuration = 1,
  startFault = false,
  stopPending = false,
  onTick,
} = {}) {
  const saved = {};
  const keys = [
    'document',
    'navigator',
    'MediaRecorder',
    'requestAnimationFrame',
    'cancelAnimationFrame',
  ];
  for (const k of keys)
    saved[k] = Object.getOwnPropertyDescriptor(globalThis, k);
  const body = {
    appendChild(v) {
      v.parentNode = this;
    },
  };
  const doc = new EventTarget();
  doc.hidden = false;
  doc.body = body;
  class Video extends EventTarget {
    constructor(i) {
      super();
      this.index = i;
      this._time = 0;
      this.duration = clockDuration;
      this.readyState = 2;
      this.muted = true;
      this.paused = true;
      this.playbackRate = 1;
      this.parentNode = body;
      this.seeks = [];
      this.playCalls = 0;
    }
    get currentTime() {
      return this._time;
    }
    set currentTime(t) {
      this._time = t;
      this.seeks.push(t);
      queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
    }
    play() {
      this.playCalls++;
      assert.equal(this.muted, true, 'Both source videos must stay muted');
      this.paused = false;
      return playPending ? new Promise(() => {}) : Promise.resolve();
    }
    pause() {
      this.paused = true;
    }
  }
  const videos = [new Video(0), new Video(1)];
  const track = () => ({
    stopped: false,
    stop() {
      this.stopped = true;
    },
  });
  const audioTrack = track(),
    videoTrack = track();
  const audioSource = {
    starts: [],
    stopped: false,
    buffer: null,
    connect() {},
    disconnect() {},
    start(...args) {
      this.starts.push(args);
    },
    stop() {
      this.stopped = true;
    },
  };
  const context = {
    currentTime: 0,
    resume: () => Promise.resolve(),
    decodeAudioData: () => Promise.resolve({ duration: clockDuration }),
    createBufferSource: () => audioSource,
    createMediaStreamDestination: () => ({
      stream: {
        getAudioTracks: () => [audioTrack],
        getTracks: () => [audioTrack],
      },
      disconnect() {},
    }),
  };
  const draws = [];
  const ctx = {
    fillStyle: '',
    fillRect(...args) {
      draws.push(['black', ...args]);
    },
    drawImage(video, ...args) {
      draws.push(['video', video.index, video.currentTime, ...args]);
    },
  };
  const stream = {
    tracks: [videoTrack],
    getTracks() {
      return this.tracks;
    },
    addTrack(t) {
      this.tracks.push(t);
    },
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: () => ctx,
    captureStream: () => stream,
  };
  let recording = false,
    failedOnce = false;
  class Recorder {
    static isTypeSupported() {
      return true;
    }
    constructor() {
      this.state = 'inactive';
      this.mimeType = 'video/mp4';
    }
    start() {
      if (startFault) throw new Error('encoder start failed');
      this.state = 'recording';
      recording = true;
    }
    stop() {
      this.state = 'inactive';
      if (stopPending) return;
      queueMicrotask(() => {
        this.ondataavailable?.({ data: new Blob([new Uint8Array(2048)]) });
        this.onstop?.();
      });
    }
  }
  Object.defineProperty(globalThis, 'document', {
    value: doc,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'navigator', {
    value: {},
    configurable: true,
  });
  Object.defineProperty(globalThis, 'MediaRecorder', {
    value: Recorder,
    configurable: true,
  });
  Object.defineProperty(globalThis, 'requestAnimationFrame', {
    configurable: true,
    value: (cb) =>
      setTimeout(() => {
        context.currentTime += 0.05;
        for (const v of videos) if (!v.paused) v._time += 0.05 * v.playbackRate;
        if (recording && lag && !failedOnce) {
          videos[1]._time -= lag;
          failedOnce = true;
        }
        onTick?.(context);
        cb();
      }, 0),
  });
  Object.defineProperty(globalThis, 'cancelAnimationFrame', {
    configurable: true,
    value: clearTimeout,
  });
  const clips = videos.map((video) => ({
    video,
    duration: clockDuration,
    file: { arrayBuffer: async () => new ArrayBuffer(20) },
  }));
  const abort = new AbortController(),
    stages = [],
    progress = [];
  const args = {
    clips,
    boxes: [
      { x: 0, y: 0, width: 0.5, height: 1 },
      { x: 0.5, y: 0, width: 0.5, height: 1 },
    ],
    order: [0, 1],
    offset: 0,
    width: 854,
    height: 480,
    audio: 0,
    context,
    canvas,
    sourceHost: {
      appendChild(v) {
        v.parentNode = this;
      },
    },
    signal: abort.signal,
    onProgress: (p) => progress.push(p),
    onStage: (...p) => stages.push(p),
  };
  return {
    args,
    abort,
    videos,
    stages,
    progress,
    draws,
    audioSource,
    tracks: [audioTrack, videoTrack],
    restore() {
      for (const k of keys) {
        if (saved[k]) Object.defineProperty(globalThis, k, saved[k]);
        else delete globalThis[k];
      }
    },
  };
}
test('fusion produces progress and a finished video', async () => {
  const env = environment();
  try {
    const blob = await renderMovie(env.args);
    assert.ok(blob.size >= 2048);
    assert.equal(blob.type, 'video/mp4');
    assert.deepEqual(
      [...new Set(env.stages.map((s) => s[0]))],
      ['preparing', 'recording', 'finalizing'],
    );
    assert.equal(env.progress[0], 0);
    assert.equal(env.progress.at(-1), 1);
    assert.ok(env.tracks.every((t) => t.stopped));
    assert.ok(env.videos.every((v) => v.paused));
  } finally {
    env.restore();
  }
});
test('a temporary multi-second playback gap is corrected instead of rejected', async () => {
  const env = environment({ lag: 3, clockDuration: 2 });
  try {
    await renderMovie(env.args);
    assert.ok(
      env.videos[1].seeks.length >= 1,
      'Lagging video must seek back to the music position',
    );
    assert.equal(env.progress.at(-1), 1);
  } finally {
    env.restore();
  }
});
test('trim offsets are applied before recording and to the chosen audio', async () => {
  const env = environment({ clockDuration: 4 });
  env.args.offset = -1;
  env.args.audio = 1;
  try {
    await renderMovie(env.args);
    assert.ok(env.videos[1].seeks.some((t) => t === 1));
    assert.equal(env.audioSource.starts[0][1], 1);
    assert.equal(env.audioSource.starts[0][2], 3);
    assert.ok(
      env.draws.some((d) => d[0] === 'black' && d[1] === 427),
      'Ended shorter clip becomes black',
    );
  } finally {
    env.restore();
  }
});
test('large source offsets are cropped before playback', async () => {
  const env = environment({ clockDuration: 8 });
  env.args.offset = 4;
  try {
    await renderMovie(env.args);
    assert.equal(env.videos[0].seeks[0], 4);
    assert.equal(env.audioSource.starts[0][1], 4);
  } finally {
    env.restore();
  }
});
test('cancellation during startup returns without waiting for play()', async () => {
  const env = environment({ playPending: true });
  try {
    const work = renderMovie(env.args);
    env.abort.abort();
    await assert.rejects(work, { name: 'AbortError' });
    assert.ok(env.videos.every((v) => v.paused));
  } finally {
    env.restore();
  }
});
test('encoder startup failure is returned and tracks are released', async () => {
  const env = environment({ startFault: true });
  try {
    await assert.rejects(renderMovie(env.args), /encoder start failed/);
    assert.ok(env.tracks.every((t) => t.stopped));
  } finally {
    env.restore();
  }
});
