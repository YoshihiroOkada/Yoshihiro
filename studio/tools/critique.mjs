// node tools/critique.mjs [--formats 16x9,9x16,1x1] [--draft]
// 見せる前のループ（講座 step 11 / 画像プロンプト verification）。主張せず、実際に描いて確かめる。
//   out/contact_<fmt>.png  … シーンごとに1枚（文字が落ち着いた瞬間）
//   out/phone.png          … 16:9 を 360px 幅に縮めたもの（スマホでの読みやすさ）
//   out/checks.json        … 決定性・点滅・読書中のカメラ静止・文字の重なり・スプリング・コントラスト
import { chromium } from 'playwright';
import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import Motion from '../lib/motion.js';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const DRAFT = process.argv.includes('--draft');
const FORMATS = arg('formats', '16x9,9x16,1x1').split(',');
const FFMPEG = process.env.FFMPEG || 'ffmpeg';
const TL = JSON.parse(readFileSync(resolve(STUDIO, 'build/timeline.js'), 'utf8').replace(/^window\.TIMELINE = /, '').replace(/;\s*$/, ''));
const TK = TL.tokens;
const sizes = { '16x9': [1920, 1080], '9x16': [1080, 1920], '1x1': [1080, 1080] };
const checks = { draft: DRAFT, missingAssets: TL.missing };
const sha = b => createHash('sha256').update(b).digest('hex').slice(0, 16);

// シーンごとの静止画の時刻: 文字が落ち着いた瞬間
const stillTimes = TL.scenes.map(s => {
  if (s.kind === 'line') return { id: s.id, t: Math.min(s.textOut - 0.05, s.textIn + TK.motion.textIn + 0.6) };
  if (s.kind === 'open') return { id: s.id, t: Math.min(1.0, s.end - 0.1) };
  return { id: s.id, t: Math.max(s.start + 1.5, s.end - 0.5) };
});
// サビへの切り替えの途中も1枚（灯が昇る瞬間）
for (const [a] of TL.chorus) stillTimes.push({ id: 'TRANSITION', t: a - 0.8 });
stillTimes.sort((a, b) => a.t - b.t);

const browser = await chromium.launch();
async function openPage(fmt) {
  const [W, H] = sizes[fmt];
  const page = await browser.newPage({ viewport: { width: W, height: H }, deviceScaleFactor: 1 });
  await page.goto(`file://${STUDIO}/index.html?format=${fmt}${DRAFT ? '' : '&final=1'}`);
  const st = await page.evaluate(() => window.ready());
  return { page, st };
}
const shot = async (page, t) => { await page.evaluate(x => window.seek(x), t); return page.locator('#c').screenshot({ type: 'png' }); };

const dir = resolve(STUDIO, 'out/stills');
rmSync(dir, { recursive: true, force: true });
mkdirSync(dir, { recursive: true });
for (const fmt of FORMATS) {
  const { page, st } = await openPage(fmt);
  checks['fonts_' + fmt] = st.fontsOk;
  for (let i = 0; i < stillTimes.length; i++) writeFileSync(`${dir}/${fmt}_${String(i).padStart(3, '0')}.png`, await shot(page, stillTimes[i].t));
  const cols = fmt === '9x16' ? 5 : 4, rows = Math.ceil(stillTimes.length / cols), w = fmt === '9x16' ? 270 : 480;
  execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${dir}/${fmt}_%03d.png`, '-vf', `scale=${w}:-1,tile=${cols}x${rows}:padding=6:color=0x141210`, '-frames:v', '1', resolve(STUDIO, `out/contact_${fmt}.png`)]);
  // 決定性: 同じ時刻を2回（間に別の時刻をはさむ）→ 一致するか
  if (fmt === '16x9') {
    const ts = [1.0, stillTimes[Math.floor(stillTimes.length / 2)].t, TL.duration - 1];
    checks.determinism = [];
    for (const t of ts) {
      const a = sha(await shot(page, t)); await shot(page, t * 0.37); const b = sha(await shot(page, t));
      checks.determinism.push({ t: +t.toFixed(2), same: a === b, a, b });
    }
    // 別のページ（読み直し）でも同じか
    const p2 = await openPage(fmt);
    const t = ts[1]; const c = sha(await shot(p2.page, t));
    checks.determinism.push({ t: +t.toFixed(2), reload: true, same: c === checks.determinism[1].a, a: checks.determinism[1].a, b: c });
    await p2.page.close();
    // 点滅: 30回/秒で平均輝度を取り、1秒あたりの急な変化（10%以上）の回数
    const lum = [];
    for (let t = 0; t < TL.duration; t += 1 / 30) { await page.evaluate(x => window.seek(x), t); lum.push(await page.evaluate(() => window.frameLuma())); }
    let worst = 0;
    for (let s = 0; s + 30 <= lum.length; s += 15) {
      let n = 0; for (let i = s + 1; i < s + 30; i++) if (Math.abs(lum[i] - lum[i - 1]) > 0.1) n++;
      worst = Math.max(worst, n / 2);   // 明→暗→明 で1回の点滅 ≒ 変化2回
    }
    checks.flashesPerSecondMax = worst;
    // 読書中のカメラ静止: 文字が出ている間、カメラが動いていないか（60回/秒）
    checks.cameraStillWhileReading = [];
    for (const s of TL.scenes.filter(s => s.kind === 'line')) {
      let maxD = 0, prev = null;
      for (let t = s.textIn + 0.3; t < s.textOut; t += 1 / 60) {
        const c = await page.evaluate(x => window.cameraAt(x), t);
        if (prev) maxD = Math.max(maxD, Math.abs(c[0] - prev[0]) * 1920, Math.abs(c[1] - prev[1]) * 1080, Math.abs(c[2] - prev[2]) * 1080);
        prev = c;
      }
      checks.cameraStillWhileReading.push({ id: s.id, maxPxPerFrame: +maxD.toFixed(3), still: maxD < 0.5 });
    }
  }
  await page.close();
}
// 16:9 を 360px 幅で（スマホ）
execFileSync(FFMPEG, ['-y', '-loglevel', 'error', '-i', `${dir}/16x9_%03d.png`, '-vf', `scale=360:-1,tile=3x${Math.ceil(stillTimes.length / 3)}:padding=4:color=0x141210`, '-frames:v', '1', resolve(STUDIO, 'out/phone.png')]);
await browser.close();

// タイムラインの検査
const lines = TL.scenes.filter(s => s.kind === 'line');
checks.textOverlap = lines.slice(1).map((s, i) => ({ a: lines[i].id, b: s.id, ok: lines[i].textOut <= s.textIn + 1e-6 }));
checks.newThingEvery = { maxGapSeconds: +Math.max(...lines.map(s => s.end - s.start), lines[0].start).toFixed(2), rule: '2〜4秒' };
checks.springs = Object.fromEntries(Object.entries(TK.spring).map(([k, v]) => [k, { dampingRatio: +Motion.dampingRatio(v.k, v.d).toFixed(3), noBounce: Motion.dampingRatio(v.k, v.d) >= 0.999 }]));
const C = TK.color;
checks.contrast = { keyword: +Motion.contrast(C.ink, C.ground).toFixed(2), emphasis: +Motion.contrast(C.accent, C.ground).toFixed(2), caption: +Motion.contrast(C.muted, C.ground).toFixed(2), min: TK.a11y.minContrast };
checks.captionPxAtPhone = { '16x9': +(TK.type.caption * 360 / 1920).toFixed(1), '9x16': +(TK.type.caption * 360 / 1080).toFixed(1) };
checks.stills = stillTimes;
writeFileSync(resolve(STUDIO, 'out/checks.json'), JSON.stringify(checks, null, 1));

const bad = [];
if (checks.determinism && checks.determinism.some(d => !d.same)) bad.push('決定性');
if (checks.flashesPerSecondMax > TK.a11y.maxFlashesPerSecond) bad.push('点滅');
if (checks.cameraStillWhileReading && checks.cameraStillWhileReading.some(c => !c.still)) bad.push('読書中にカメラが動く');
if (checks.textOverlap.some(o => !o.ok)) bad.push('文字の重なり');
if (Object.values(checks.springs).some(s => !s.noBounce)) bad.push('バウンス');
if (Math.min(checks.contrast.keyword, checks.contrast.emphasis, checks.contrast.caption) < TK.a11y.minContrast) bad.push('コントラスト');
console.log(bad.length ? 'NG: ' + bad.join(', ') : '機械チェック: すべてOK', '| 素材不足:', TL.missing.length, '| 点滅/秒 最大:', checks.flashesPerSecondMax);
