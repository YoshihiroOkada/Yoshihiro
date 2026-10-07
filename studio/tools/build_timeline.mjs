// node tools/build_timeline.mjs --lrc ../samples/sample.lrc [--beats build/beats.json] [--duration 34]
// LRC（＋拍）から唯一のタイムラインを作る:
//   build/timeline.js（描画が読む）、../docs/shotlist.md（全ショット）、out/captions.srt（字幕）
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = dirname(fileURLToPath(import.meta.url));
const STUDIO = resolve(HERE, '..');
const ROOT = resolve(STUDIO, '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };

const tokens = JSON.parse(readFileSync(resolve(ROOT, 'brand/tokens.json'), 'utf8'));
const lrcPath = resolve(process.cwd(), arg('lrc', resolve(ROOT, 'samples/sample.lrc')));
const beatsPath = arg('beats', resolve(STUDIO, 'build/beats.json'));
const manifestPath = resolve(STUDIO, 'assets/manifest.json');
const assetList = JSON.parse(readFileSync(resolve(STUDIO, 'assets/asset_list.json'), 'utf8'));

// ---------------- LRC ----------------
const trim = s => s.replace(/^[\s　﻿]+|[\s　]+$/g, '');
function parseLRC(text) {
  const out = { entries: [], title: '', artist: '' };
  for (let row of text.replace(/\r\n?/g, '\n').split('\n')) {
    row = trim(row);
    if (!row) continue;
    const times = [];
    let m;
    while ((m = /^\s*\[([^\]]*)\]/.exec(row))) {
      const tag = trim(m[1]);
      const tm = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
      if (tm) times.push(+tm[1] * 60 + +tm[2] + (tm[3] ? parseFloat('0.' + tm[3]) : 0));
      else {
        const meta = /^(ti|ar)\s*:(.*)$/i.exec(tag);
        if (meta) out[meta[1].toLowerCase() === 'ti' ? 'title' : 'artist'] = trim(meta[2]);
      }
      row = row.slice(m[0].length);
    }
    const body = trim(row.replace(/<\d+:\d+(?:[.:]\d+)?>/g, ''));
    for (const t of times) out.entries.push({ time: t, text: body });
  }
  out.entries.sort((a, b) => a.time - b.time);
  return out;
}

// 長い文字列を 1行 max 文字・最大 lines 行に（空白があれば空白で）
function wrap(s, max, lines) {
  const out = [];
  let rest = trim(s);
  while (rest.length > max && out.length < lines - 1) {
    let cut = -1;
    for (let i = max; i > max * 0.5; i--) if (/[\s　]/.test(rest[i])) { cut = i; break; }
    if (cut < 0) cut = max;
    out.push(trim(rest.slice(0, cut)));
    rest = trim(rest.slice(cut));
  }
  out.push(rest);
  return out;
}

// 画面の言葉（錨）: {} 指定 > 空白区切りの最後のまとまり。行全体は画面に出さない（全文は字幕だけ）
function pickAnchor(s) {
  const max = tokens.type.maxChars, maxL = tokens.type.maxLines;
  const found = [...s.matchAll(/\{([^}]+)\}/g)].map(m => trim(m[1]));
  if (found.length) return { lines: found.slice(0, maxL), auto: false };
  const plain = trim(s.replace(/[\/\uFF0F]/g, ' '));
  const chunks = plain.split(/[\s\u3000]+/).filter(Boolean);
  if (chunks.length > 1) {
    const c = chunks.slice().reverse().find(x => x.length >= 2 && x.length <= max);
    if (c) return { lines: [c], auto: true };
  }
  // 区切りが無い行は自動で選べない → {} で指定してもらう（仮に全体を出し、shotlist で警告）
  return { lines: wrap(plain, max, maxL), auto: true, needsAnchor: true, tooLong: plain.length > max * maxL };
}

const lrc = parseLRC(readFileSync(lrcPath, 'utf8'));
const lines = [];
for (let i = 0; i < lrc.entries.length; i++) {
  let txt = trim(lrc.entries[i].text);
  if (!txt || txt === '-') continue;
  const next = lrc.entries.slice(i + 1).find(e => e.time > lrc.entries[i].time + 0.001);
  let emph = false;
  if (/^[!！]/.test(txt)) { emph = true; txt = trim(txt.slice(1)); }
  if (lines.length && Math.abs(lines[lines.length - 1].start - lrc.entries[i].time) < 0.001) continue;
  const a = pickAnchor(txt);
  lines.push({
    start: lrc.entries[i].time, end: next ? next.time : lrc.entries[i].time + 4,
    anchor: a.lines, auto: a.auto, tooLong: !!a.tooLong, needsAnchor: !!a.needsAnchor, emph,
    caption: trim(txt.replace(/[{}]/g, '')).split(/[\/／]/).map(trim)
  });
}
if (!lines.length) throw new Error('表示できる歌詞がありません: ' + lrcPath);

// ---------------- 拍 ----------------
let beats = null;
if (existsSync(beatsPath)) beats = JSON.parse(readFileSync(beatsPath, 'utf8'));
// 文字の登場を近い拍（0.12秒以内）に合わせる
const snap = t => {
  if (!beats || !beats.beats || !beats.beats.length) return t;
  let best = t, bd = 0.12;
  for (const b of beats.beats) { const d = Math.abs(b - t); if (d < bd) { bd = d; best = b; } }
  return best;
};

// ---------------- サビ（! 行）の区間 ----------------
const chorus = [];
for (const l of lines.filter(l => l.emph)) {
  const last = chorus[chorus.length - 1];
  if (last && l.start - last[1] < 1.5) last[1] = Math.max(last[1], l.end);
  else chorus.push([l.start, l.end]);
}

// ---------------- シーンとカメラ ----------------
const M = tokens.motion;
const lastEnd = lines[lines.length - 1].end;
const duration = +arg('duration', 0) || (beats && beats.duration) || Math.ceil(lastEnd + 3);
const rand = (seed => () => { seed |= 0; seed = (seed + 0x6D2B79F5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; })(+arg('seed', 7));

const scenes = [];
const TRANS = M.sceneMove;
// その時刻に始まる場面の移動（サビへ上がる / 戻る）の開始時刻
const sceneMoves = chorus.flatMap(([a, b]) => [a - TRANS, b - TRANS]);
scenes.push({ id: 'OPEN', kind: 'open', start: 0, end: lines[0].start, teaches: '冒頭の絵（Question）: 墓の上に置かれた仮面' });
// 行 i の直前のカメラ移動の長さ（前の行との間隔の 30% まで、最大 cameraMove）
const moveIn = i => Math.min(M.cameraMove, Math.max(0.2, (lines[i].start - (i > 0 ? lines[i - 1].start : 0)) * 0.3));
lines.forEach((l, i) => {
  const next = lines[i + 1];
  const tEnd = next ? next.start : l.end;
  const textIn = snap(l.start);
  // 文字は「歌詞を消す(-)」「次の移動」「場面の移動」のどれよりも先に消える
  let textOut = Math.min(l.end, next ? next.start - moveIn(i + 1) : l.end);
  for (const m of sceneMoves) if (m > textIn + 0.5 && m < textOut) textOut = m;
  scenes.push({
    id: 'LINE_' + String(i + 1).padStart(3, '0') + (l.emph ? '_CHORUS' : ''), kind: 'line',
    start: l.start, end: tEnd, textIn, textOut, move: moveIn(i),
    anchor: l.anchor, caption: l.caption, emph: l.emph, auto: l.auto, tooLong: l.tooLong, needsAnchor: l.needsAnchor,
    // カメラの構図: 行ごとに左右へ（ジグザグ）・ズームは強調行で少し寄る
    shot: { x: (i % 2 === 0 ? -1 : 1) * (0.06 + rand() * 0.05), zoom: l.emph ? 1.12 : 1.0 + rand() * 0.05 }
  });
});
scenes.push({ id: 'PAYOFF', kind: 'payoff', start: lastEnd, end: duration, teaches: '冒頭の絵に戻る（Payoff）' });

// カメラのキー: 値の変化は「行の開始 - 移動時間」に始まり、行の開始までに止まる（読んでいる間は静止）
const camKeys = [[0, [0, 1]]];
for (const s of scenes.filter(s => s.kind === 'line')) camKeys.push([s.start - s.move, [s.shot.x, s.shot.zoom]]);
camKeys.push([lastEnd, [0, 1]]);

// ---------------- 素材 ----------------
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { assets: {} };
const assets = {};
const missing = [];
for (const a of assetList.assets) {
  const got = manifest.assets[a.id];
  if (got && existsSync(resolve(STUDIO, got.file))) assets[a.id] = { file: got.file, w: got.w, h: got.h, role: a.role };
  else missing.push(a.id);
}

// 小物の配置（シード固定）: 区間ごとに左右へ。z は奥行き（大きいほど奥）
const props = [];
const verseProps = ['tomb', 'cross', 'tree', 'pumpkin_lit'];
const chorusProps = ['pillar', 'chandelier', 'dancers'];
for (let i = 0; i < 14; i++) {
  const side = i % 2 === 0 ? -1 : 1;
  props.push({ section: 'verse', id: verseProps[i % verseProps.length], x: side * (0.55 + rand() * 0.35), z: 0.35 + rand() * 0.6, phase: rand() });
  props.push({ section: 'chorus', id: chorusProps[i % chorusProps.length], x: side * (0.5 + rand() * 0.4), z: 0.35 + rand() * 0.6, phase: rand() });
}

const timeline = {
  title: lrc.title, artist: lrc.artist, duration, tokens,
  scenes, camKeys, chorus, props, assets, missing,
  beats: beats ? { bpm: beats.bpm, beats: beats.beats, downbeats: beats.downbeats } : null
};
mkdirSync(resolve(STUDIO, 'build'), { recursive: true });
mkdirSync(resolve(STUDIO, 'out'), { recursive: true });
writeFileSync(resolve(STUDIO, 'build/timeline.js'), 'window.TIMELINE = ' + JSON.stringify(timeline, null, 1) + ';\n');

// ---------------- captions.srt ----------------
const srtT = t => { const ms = Math.round(t * 1000); const p = (n, w) => String(n).padStart(w, '0');
  return `${p(Math.floor(ms / 3600000), 2)}:${p(Math.floor(ms / 60000) % 60, 2)}:${p(Math.floor(ms / 1000) % 60, 2)},${p(ms % 1000, 3)}`; };
const lineScenes = scenes.filter(s => s.kind === 'line');
writeFileSync(resolve(STUDIO, 'out/captions.srt'), lineScenes.map((s, i) =>
  `${i + 1}\n${srtT(s.start)} --> ${srtT(s.end)}\n${s.caption.join('\n')}\n`).join('\n'));

// ---------------- shotlist.md（全ショット: フレーム・カメラ・文字・音） ----------------
const f = t => t.toFixed(2) + 's';
const fr = t => Math.round(t * 60);
const md = ['# SHOTLIST（自動生成: tools/build_timeline.mjs）', '',
  `曲: ${lrc.title || '（未設定）'} / ${lrc.artist || '（未設定）'}　長さ ${duration}s　拍: ${beats ? beats.bpm.toFixed(1) + ' BPM' : '未測定（beats.py を実行）'}`, '',
  '| ID | 時間 | フレーム(60fps) | 教えること / 画面の言葉 | カメラ | 文字の出入り | 字幕 | 音 | 確認: 見た人が言えること |',
  '|---|---|---|---|---|---|---|---|---|'];
for (const s of scenes) {
  if (s.kind === 'line') {
    md.push(`| ${s.id} | ${f(s.start)}–${f(s.end)} | ${fr(s.start)}–${fr(s.end)} | ${s.anchor.join(' / ')}${s.auto ? '（自動）' : ''}${s.emph ? ' **サビ**' : ''} | ` +
      `${f(s.start - s.move)}→${f(s.start)} 移動、以後静止（x ${s.shot.x.toFixed(2)}, zoom ${s.shot.zoom.toFixed(2)}） | in ${f(s.textIn)} / out ${f(s.textOut)} | ${s.caption.join(' / ')} | 原曲（拍に合わせて登場） | 「${s.anchor.join('')}」 |`);
  } else {
    md.push(`| ${s.id} | ${f(s.start)}–${f(s.end)} | ${fr(s.start)}–${fr(s.end)} | ${s.teaches} | ${s.kind === 'open' ? '静止' : '戻って静止'} | — | — | ${s.kind === 'open' ? '前奏' : '後奏'} | 「${s.kind === 'open' ? '仮面が置かれている' : '最初の絵の意味がわかった'}」 |`);
  }
}
md.push('', '## サビ（舞踏会）の区間', chorus.length ? chorus.map(c => `- ${f(c[0])}–${f(c[1])}`).join('\n') : '- なし');
md.push('', '## 素材', missing.length ? `- **未生成: ${missing.join(', ')}**（tools/gen_assets.mjs で生成）` : '- すべて生成済み');
const too = lineScenes.filter(s => s.tooLong).map(s => s.id);
const need = lineScenes.filter(s => s.needsAnchor).map(s => s.id);
md.push('', '## 自動チェック',
  `- キーワード 最大${tokens.type.maxLines}行・1行${tokens.type.maxChars}文字: ${too.length ? '**長すぎ ' + too.join(', ') + '**' : 'OK'}`,
  `- 画面に歌詞の全文を出さない: ${need.length ? '**{} でキーワード指定が必要 ' + need.join(', ') + '**' : 'OK'}`,
  `- 2〜4秒ごとに新しいこと: 行の間隔 最大 ${Math.max(...lineScenes.map(s => s.end - s.start)).toFixed(2)}s`);
writeFileSync(resolve(ROOT, 'docs/shotlist.md'), md.join('\n') + '\n');

console.log(`timeline: ${scenes.length} scenes, ${duration}s, chorus ${chorus.length}, missing assets ${missing.length}`);
