// node render.mjs --format 16x9 [--reduced] [--fps 60] [--sub 4] [--from 0] [--to <dur>] [--draft]
// 講座 step 7 の route A: ページが任意の瞬間を描き、ここが時間を進めて ffmpeg に流す。
//   --draft: 素材が足りなくても下書きとして描く（名前を文字で表示）。付けないと素材不足で止まる
import { chromium } from 'playwright';
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = dirname(fileURLToPath(import.meta.url));
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const flag = k => process.argv.includes('--' + k);
const FORMAT = arg('format', '16x9'), FPS = +arg('fps', 60), SUB = +arg('sub', 4);
const REDUCED = flag('reduced'), DRAFT = flag('draft');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
mkdirSync(resolve(STUDIO, 'out'), { recursive: true });

const browser = await chromium.launch();
const sizes = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080], animatic: [960, 540] };
const [W, H] = sizes[FORMAT];
const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
await page.goto(`file://${STUDIO}/index.html?format=${FORMAT}${REDUCED ? '&reduced=1' : ''}${DRAFT ? '' : '&final=1'}`);
const st = await page.evaluate(() => window.ready());
if (st.missing.length && !DRAFT) {
  console.error(`素材が足りません: ${st.missing.join(', ')}\n先に tools/gen_assets.mjs で生成してください（下書きなら --draft）。`);
  await browser.close();
  process.exit(3);
}
if (!st.fontsOk) console.warn('警告: 表示用フォントが読み込めていません（tools/fetch_fonts.mjs を実行）');
const info = await page.evaluate(() => window.frameInfo());
const FROM = +arg('from', 0), TO = +arg('to', info.duration);

const name = `${DRAFT ? 'draft' : 'silent'}_${FORMAT}${REDUCED ? '_reduced' : ''}`;
const outFile = resolve(STUDIO, 'out', name + '.mp4');
// tmix で SUB 枚のサブフレームを平均（モーションブラー）、各グループの最後だけ残す
const vf = SUB > 1 ? `tmix=frames=${SUB},select='eq(mod(n\\,${SUB})\\,${SUB - 1})',setpts=N/${FPS}/TB` : 'null';
const ff = spawn(FFMPEG, ['-y', '-loglevel', 'error', '-f', 'image2pipe', '-framerate', String(FPS * SUB), '-i', '-',
  '-vf', vf, '-r', String(FPS), '-c:v', 'libx264', '-crf', '16', '-pix_fmt', 'yuv420p', outFile],
  { stdio: ['pipe', 'inherit', 'inherit'] });

const total = Math.round((TO - FROM) * FPS * SUB);
for (let i = 0; i < total; i++) {
  await page.evaluate((t) => window.seek(t), FROM + i / (FPS * SUB));
  const png = await page.locator('#c').screenshot({ type: 'png' });
  if (!ff.stdin.write(png)) await new Promise((r) => ff.stdin.once('drain', r));
  if (i % (FPS * SUB) === 0) process.stdout.write(`\r${name}: ${(i / (FPS * SUB)).toFixed(0)}s / ${(TO - FROM).toFixed(0)}s`);
}
ff.stdin.end();
await new Promise((r) => ff.on('close', r));
await browser.close();
console.log(`\n${outFile}`);
