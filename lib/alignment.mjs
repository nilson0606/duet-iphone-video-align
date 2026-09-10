// Spectral onset fingerprints: log energy differences in six frequency bands.
// FFT cross-correlation runs in a worker; each lag is overlap-normalized.
export const FEATURE_RATE = 50;
export function fft(re, im, inverse = false) {
  const n = re.length;
  for (let i = 1, j = 0; i < n; i++) {
    let bit = n >> 1;
    for (; j & bit; bit >>= 1) j ^= bit;
    j ^= bit;
    if (i < j) {
      [re[i], re[j]] = [re[j], re[i]];
      [im[i], im[j]] = [im[j], im[i]];
    }
  }
  for (let len = 2; len <= n; len *= 2) {
    const angle = ((inverse ? 2 : -2) * Math.PI) / len,
      wr = Math.cos(angle),
      wi = Math.sin(angle);
    for (let base = 0; base < n; base += len) {
      let xr = 1,
        xi = 0;
      for (let j = 0; j < len / 2; j++) {
        const u = base + j,
          v = u + len / 2;
        const tr = re[v] * xr - im[v] * xi,
          ti = re[v] * xi + im[v] * xr;
        re[v] = re[u] - tr;
        im[v] = im[u] - ti;
        re[u] += tr;
        im[u] += ti;
        const nr = xr * wr - xi * wi;
        xi = xr * wi + xi * wr;
        xr = nr;
      }
    }
  }
  if (inverse)
    for (let i = 0; i < n; i++) {
      re[i] /= n;
      im[i] /= n;
    }
}
export function fingerprints(samples, rate) {
  const hop = Math.round(rate / FEATURE_RATE),
    n = 512,
    frames = Math.floor((samples.length - n) / hop);
  if (frames < 100) throw new Error('音訊太短，請使用至少 3 秒的影片。');
  const edges = [120, 250, 500, 1000, 2000, 4000, Math.min(7600, rate / 2)];
  const bands = Array.from({ length: 6 }, () => new Float32Array(frames));
  const re = new Float64Array(n),
    im = new Float64Array(n),
    previous = new Float64Array(6);
  for (let f = 0; f < frames; f++) {
    for (let j = 0; j < n; j++) {
      re[j] =
        samples[f * hop + j] *
        (0.5 - 0.5 * Math.cos((2 * Math.PI * j) / (n - 1)));
      im[j] = 0;
    }
    fft(re, im);
    for (let b = 0; b < 6; b++) {
      let energy = 0;
      const low = Math.ceil((edges[b] * n) / rate),
        high = Math.min(n / 2, Math.floor((edges[b + 1] * n) / rate));
      for (let k = low; k <= high; k++) energy += re[k] * re[k] + im[k] * im[k];
      const value = Math.log(1e-8 + energy);
      bands[b][f] = f ? value - previous[b] : 0;
      previous[b] = value;
    }
  }
  // A 100 ms triangular window suppresses microphone/room noise while preserving
  // the musical onset timing on the 20 ms grid. Both tracks use the same
  // symmetric window, so it adds no relative delay.
  return bands.map((band) =>
    Float32Array.from(band, (_, i) => {
      let value = 0,
        total = 0;
      for (let k = -2; k <= 2; k++) {
        if (i + k < 0 || i + k >= band.length) continue;
        const weight = 3 - Math.abs(k);
        value += band[i + k] * weight;
        total += weight;
      }
      return value / total;
    }),
  );
}
function prefix(a) {
  const p = new Float64Array(a.length + 1);
  for (let i = 0; i < a.length; i++) p[i + 1] = p[i] + a[i] * a[i];
  return p;
}
export function alignFeatures(a, b) {
  const na = a[0].length,
    nb = b[0].length,
    minOverlap = Math.min(250, Math.floor(Math.min(na, nb) * 0.65));
  let n = 1;
  while (n < na + nb) n *= 2;
  const low = -(nb - minOverlap),
    high = na - minOverlap,
    scores = new Float64Array(high - low + 1);
  for (let band = 0; band < a.length; band++) {
    const ar = new Float64Array(n),
      ai = new Float64Array(n),
      br = new Float64Array(n),
      bi = new Float64Array(n);
    ar.set(a[band]);
    br.set(b[band]);
    fft(ar, ai);
    fft(br, bi);
    for (let i = 0; i < n; i++) {
      const real = ar[i] * br[i] + ai[i] * bi[i];
      ai[i] = ai[i] * br[i] - ar[i] * bi[i];
      ar[i] = real;
    }
    fft(ar, ai, true);
    const pa = prefix(a[band]),
      pb = prefix(b[band]);
    for (let lag = low; lag <= high; lag++) {
      const sa = Math.max(0, lag),
        sb = Math.max(0, -lag),
        len = Math.min(na - sa, nb - sb);
      const energy = Math.sqrt(
        (pa[sa + len] - pa[sa]) * (pb[sb + len] - pb[sb]),
      );
      if (energy > 1e-7)
        scores[lag - low] += ar[(lag + n) % n] / energy / a.length;
    }
  }
  let best = 0;
  for (let i = 1; i < scores.length; i++)
    if (scores[i] > scores[best]) best = i;
  let second = -1;
  for (let i = 0; i < scores.length; i++)
    if (Math.abs(i - best) > 25) second = Math.max(second, scores[i]);
  const score = scores[best],
    margin = score - second;
  return {
    offset: (best + low) / FEATURE_RATE,
    score,
    margin,
    confident: score > 0.2 && margin > 0.055,
  };
}
