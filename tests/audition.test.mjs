import assert from 'node:assert/strict';
import test from 'node:test';
import { AuditionPlayer } from '../lib/audition-player.ts';

class Video extends EventTarget {
  constructor(duration = 20) {
    super();
    this.duration = duration;
    this._time = 0;
    this.readyState = 2;
    this.paused = true;
    this.ended = false;
    this.playCalls = 0;
    this.seekCalls = [];
  }
  get currentTime() {
    return this._time;
  }
  set currentTime(value) {
    this._time = value;
    this.seekCalls.push(value);
    queueMicrotask(() => this.dispatchEvent(new Event('seeked')));
  }
  play() {
    this.playCalls++;
    this.paused = false;
    return Promise.resolve();
  }
  pause() {
    this.paused = true;
  }
}
function setup(t, videos = [new Video(20), new Video(15)]) {
  const sources = [],
    graph = {
      gain: { value: 0 },
      connect() {},
      disconnect() {
        this.disconnected = true;
      },
    };
  const context = {
    destination: {},
    resumes: 0,
    closed: false,
    resume() {
      this.resumes++;
      return Promise.resolve();
    },
    close() {
      this.closed = true;
      return Promise.resolve();
    },
    createGain: () => graph,
    createMediaElementSource(video) {
      assert.ok(
        !sources.some((s) => s.video === video),
        'Never attach a second media source',
      );
      const source = {
        video,
        connect(to) {
          this.target = to;
        },
        disconnect() {
          this.disconnected = true;
        },
      };
      sources.push(source);
      return source;
    },
  };
  const player = new AuditionPlayer(videos, () => context);
  t.after(() => player.dispose());
  return { videos, player, context, graph, sources };
}
test('A and B can play independently, and pausing or seeking A leaves B playing', async (t) => {
  const { player, videos } = setup(t);
  await player.playOne(0);
  assert.deepEqual(
    videos.map((v) => v.paused),
    [false, true],
  );
  await player.playOne(1);
  assert.deepEqual(
    videos.map((v) => v.paused),
    [false, false],
  );
  player.pauseOne(0);
  assert.deepEqual(
    videos.map((v) => v.paused),
    [true, false],
  );
  player.seekOne(0, 3.5);
  assert.equal(videos[0].currentTime, 3.5);
  assert.equal(videos[1].currentTime, 0);
  assert.equal(videos[1].paused, false);
});
test('single loaded clip supports audition before B is loaded', async (t) => {
  const { player, videos } = setup(t, [new Video(), null]);
  await player.playOne(0);
  assert.equal(videos[0].paused, false);
  await assert.rejects(player.playTogether(0, 0), /兩部影片/);
});
for (const [offset, expected] of [
  [2, [5, 3]],
  [-2, [3, 5]],
]) {
  test(`together playback applies independent ${offset} second offset and listening position`, async (t) => {
    const { player, videos, graph, sources } = setup(t);
    const operation = player.playTogether(offset, 3);
    assert.ok(
      videos.every((v) => v.playCalls === 1),
      'Both players must be primed before awaiting',
    );
    assert.equal(graph.gain.value, 0, 'Priming must be inaudible');
    await operation;
    assert.deepEqual(
      videos.map((v) => v.currentTime),
      expected,
    );
    assert.ok(videos.every((v) => !v.paused));
    assert.equal(sources.length, 2);
    assert.ok(sources.every((s) => s.target === graph));
    assert.equal(graph.gain.value, 0.5);
    player.pauseAll();
    assert.ok(videos.every((v) => v.paused));
    assert.equal(graph.gain.value, 0);
    await player.playTogether(0, 1);
    assert.deepEqual(
      videos.map((v) => v.currentTime),
      [1, 1],
    );
    assert.equal(sources.length, 2);
  });
}
test('invalid offset or position is rejected before playback starts', async (t) => {
  const { player, videos } = setup(t);
  for (const [offset, position] of [
    [NaN, 0],
    [30, 0],
    [0, -1],
    [0, 15],
    [0, NaN],
  ])
    await assert.rejects(player.playTogether(offset, position));
  assert.ok(videos.every((v) => v.playCalls === 0));
});
test('pause cancels pending start and a late play completion cannot restart the pair', async (t) => {
  const { player, videos, graph } = setup(t);
  let finish;
  videos[1].play = () => {
    videos[1].paused = false;
    return new Promise((resolve) => {
      finish = resolve;
    });
  };
  const pending = player.playTogether(0, 0);
  player.pauseAll();
  await assert.rejects(pending, { name: 'AbortError' });
  finish();
  await Promise.resolve();
  assert.ok(videos.every((v) => v.paused));
  assert.equal(graph.gain.value, 0);
});
test('failed second-player startup pauses both and leaves no audible partial preview', async (t) => {
  const { player, videos, graph } = setup(t);
  videos[1].play = () =>
    Promise.reject(new DOMException('Blocked', 'NotAllowedError'));
  await assert.rejects(player.playTogether(0, 0), { name: 'NotAllowedError' });
  assert.ok(videos.every((v) => v.paused));
  assert.equal(graph.gain.value, 0);
});
test('disposal stops audition and closes only its own audio graph', async (t) => {
  const { player, videos, context, sources, graph } = setup(t);
  await player.playTogether(0, 0);
  player.dispose();
  assert.ok(videos.every((v) => v.paused));
  assert.equal(context.closed, true);
  assert.ok(sources.every((s) => s.disconnected));
  assert.equal(graph.disconnected, true);
  await assert.rejects(player.playOne(0), /已關閉/);
});
