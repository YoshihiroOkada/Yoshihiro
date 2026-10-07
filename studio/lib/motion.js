// lib/motion.js — 動きの部品（すべて時間の純関数。ブラウザでも Node でも使える）
(function (root) {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));

  // 閉形式の減衰スプリング 0 → 1。z >= 1（臨界〜過減衰）ならバウンスしない
  function spring(t, k = 170, d = 26) {
    if (t <= 0) return 0;
    const w0 = Math.sqrt(k), z = d / (2 * w0);
    if (z < 1) {
      const wd = w0 * Math.sqrt(1 - z * z);
      return 1 - Math.exp(-z * w0 * t) * (Math.cos(wd * t) + (z * w0 / wd) * Math.sin(wd * t));
    }
    if (z === 1) return 1 - Math.exp(-w0 * t) * (1 + w0 * t);
    // 過減衰
    const r1 = -w0 * (z - Math.sqrt(z * z - 1)), r2 = -w0 * (z + Math.sqrt(z * z - 1));
    const c2 = r1 / (r2 - r1), c1 = -1 - c2;
    return 1 + c1 * Math.exp(r1 * t) + c2 * Math.exp(r2 * t);
  }

  // 減衰比（バウンスするかどうかの検査用）
  const dampingRatio = (k, d) => d / (2 * Math.sqrt(k));

  // 目標が何度も変わる値: 変化ごとにスプリングを1本足す（どのフレームも単独で計算できる）
  // keys: [[time, value], ...] 時刻順
  function track(t, keys, k = 170, d = 26) {
    let v = keys[0][1];
    for (let i = 1; i < keys.length; i++) v += (keys[i][1] - keys[i - 1][1]) * spring(t - keys[i][0], k, d);
    return v;
  }

  // 配列の値（[x, y, scale] など）版
  function trackVec(t, keys, k, d) {
    const n = keys[0][1].length, out = [];
    for (let j = 0; j < n; j++) out.push(track(t, keys.map(kv => [kv[0], kv[1][j]]), k, d));
    return out;
  }

  // 入れ替わる文字: 開始後に入り、次の切り替えの前に出る（重ならない）
  function swapAlpha(t, tIn, tOut, inDur = 0.12, outDur = 0.1) {
    return Math.min(clamp((t - tIn) / inDur), clamp((tOut - t) / outDur));
  }

  // シード固定の乱数（mulberry32）。Math.random は使わない
  function rng(seed) {
    return function () {
      seed |= 0; seed = (seed + 0x6D2B79F5) | 0;
      let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }

  const loopT = (t, dur) => ((t % dur) + dur) % dur;

  // WCAG コントラスト比
  function contrast(hexA, hexB) {
    const lum = h => {
      const c = [1, 3, 5].map(i => parseInt(h.slice(i, i + 2), 16) / 255)
        .map(x => (x <= 0.03928 ? x / 12.92 : Math.pow((x + 0.055) / 1.055, 2.4)));
      return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
    };
    const a = lum(hexA), b = lum(hexB);
    return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
  }

  // レイアウト（グリッド1つ）: 形式ごとに寸法を作り直す
  function layout(W, H, tokens) {
    const g = tokens.grid, unit = Math.min(W, H) / 1080;
    const margin = W * g.margin, gutter = W * g.gutter;
    const colW = (W - 2 * margin - gutter * (g.columns - 1)) / g.columns;
    const col = n => margin + (n - 1) * (colW + gutter);
    const snap = v => Math.round(v / (g.baseline * unit)) * g.baseline * unit;
    const narrow = W < H * 1.2;
    return {
      W, H, unit, narrow, col, colW, margin,
      display: snap(tokens.type.display * unit),
      caption: snap(tokens.type.caption * unit),
      captionBandH: Math.round(H * g.captionBand * (narrow ? 1.3 : 1)),
      keywordX: narrow ? W / 2 : col(2),
      keywordAlign: narrow ? 'center' : 'left',
      keywordY: H * (narrow ? 0.34 : 0.40)
    };
  }

  const api = { clamp, spring, dampingRatio, track, trackVec, swapAlpha, rng, loopT, contrast, layout };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Motion = api;
})(typeof window !== 'undefined' ? window : globalThis);
