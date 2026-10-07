// node tools/mux.mjs --video out/silent_16x9.mp4 --audio ../audio/song.wav --out out/final_16x9.mp4
// 曲をそのまま使い、2パスの loudnorm で -14 LUFS（integrated）・トゥルーピーク -1.5 dBTP に合わせて映像と合わせる。
import { execFileSync, spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tokens = JSON.parse(readFileSync(resolve(STUDIO, '../brand/tokens.json'), 'utf8'));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const video = resolve(process.cwd(), arg('video')), audio = resolve(process.cwd(), arg('audio')), out = resolve(process.cwd(), arg('out'));
const I = tokens.audio.lufs, TP = tokens.audio.truePeak;

// 1パス目: 測る（ffmpeg は結果を標準エラーに出す）
const measure = file => {
  const r = spawnSync(FFMPEG, ['-hide_banner', '-i', file, '-af', `loudnorm=I=${I}:TP=${TP}:LRA=11:print_format=json`, '-f', 'null', '-'], { encoding: 'utf8' });
  return JSON.parse(r.stderr.match(/\{[\s\S]*\}/)[0]);
};
const measured = measure(audio);
// 2パス目: 合わせて、映像と多重化
const af = `loudnorm=I=${I}:TP=${TP}:LRA=11:measured_I=${measured.input_i}:measured_TP=${measured.input_tp}:` +
  `measured_LRA=${measured.input_lra}:measured_thresh=${measured.input_thresh}:offset=${measured.target_offset}:linear=true`;
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', video, '-i', audio, '-map', '0:v', '-map', '1:a', '-c:v', 'copy',
  '-af', af, '-ar', '48000', '-c:a', 'aac', '-b:a', '256k', '-shortest', out], { stdio: 'inherit' });
// 確かめる（出力をもう一度測る）
const after = measure(out);
console.log(`loudness: ${after.input_i} LUFS (目標 ${I}), true peak: ${after.input_tp} dBTP (上限 ${TP})`);
