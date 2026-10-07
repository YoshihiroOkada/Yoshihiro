// node tools/gen_assets.mjs [--only mask,tomb] [--force]
// MVの絵を OpenAI 画像API（ChatGPT の画像生成）で作る。図形で代用しない。
//   キー: 環境変数 OPENAI_API_KEY（ログにもファイルにも出さない）
//   モデル: OPENAI_IMAGE_MODEL（既定 gpt-image-1）
//   出力: assets/img/<id>.png と assets/manifest.json
import { readFileSync, writeFileSync, existsSync, mkdirSync, rmSync, mkdtempSync } from 'node:fs';
import { dirname, resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const arg = (k, d) => { const i = process.argv.indexOf('--' + k); return i > 0 ? process.argv[i + 1] : d; };
const force = process.argv.includes('--force');
const only = arg('only', '') ? arg('only', '').split(',') : null;

const key = process.env.OPENAI_API_KEY;
if (!key) {
  console.error('OPENAI_API_KEY がありません。環境の設定（Network secrets / 環境変数）に追加してから、新しいセッションで実行してください。');
  process.exit(2);
}
const model = process.env.OPENAI_IMAGE_MODEL || 'gpt-image-1';

const list = JSON.parse(readFileSync(resolve(STUDIO, 'assets/asset_list.json'), 'utf8'));
const manifestPath = resolve(STUDIO, 'assets/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { model, assets: {} };
mkdirSync(resolve(STUDIO, 'assets/img'), { recursive: true });

// PNG の幅・高さ（IHDR）
const pngSize = buf => ({ w: buf.readUInt32BE(16), h: buf.readUInt32BE(20) });

// キーは一時ファイルのヘッダーとして curl に渡す（コマンドラインに出さない）
const tmp = mkdtempSync(join(tmpdir(), 'gen-'));
const headerFile = join(tmp, 'h.txt');
writeFileSync(headerFile, `Authorization: Bearer ${key}\nContent-Type: application/json\n`, { mode: 0o600 });

try {
  for (const a of list.assets) {
    if (only && !only.includes(a.id)) continue;
    const out = resolve(STUDIO, `assets/img/${a.id}.png`);
    if (existsSync(out) && !force) { console.log(`skip ${a.id}（生成済み。作り直すなら --force）`); continue; }
    const prompt = [a.prompt, a.role === 'plate' ? list.plate : list.cutout, list.style].join('\n');
    const body = { model, prompt, size: a.size, n: 1, quality: 'high', output_format: 'png' };
    if (a.role === 'cutout') body.background = 'transparent';
    const bodyFile = join(tmp, 'b.json');
    writeFileSync(bodyFile, JSON.stringify(body));
    console.log(`generate ${a.id} (${a.size}, ${a.role}) ...`);
    const res = execFileSync('curl', ['-sS', '--fail-with-body', 'https://api.openai.com/v1/images/generations',
      '-H', '@' + headerFile, '--data-binary', '@' + bodyFile], { maxBuffer: 200e6 }).toString();
    const json = JSON.parse(res);
    const b64 = json.data && json.data[0] && json.data[0].b64_json;
    if (!b64) throw new Error(`${a.id}: 画像が返ってきませんでした: ${res.slice(0, 300)}`);
    const buf = Buffer.from(b64, 'base64');
    writeFileSync(out, buf);
    const { w, h } = pngSize(buf);
    manifest.model = model;
    manifest.assets[a.id] = { file: `assets/img/${a.id}.png`, w, h, role: a.role, prompt, revised: json.data[0].revised_prompt || null };
    writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
    console.log(`  saved ${out} (${w}x${h})`);
  }
} catch (e) {
  // 失敗内容にキーが含まれないよう、レスポンス本文だけを出す
  console.error('生成に失敗:', String(e.stdout || e.message).replace(/sk-[A-Za-z0-9_-]+/g, 'sk-***').slice(0, 800));
  process.exitCode = 1;
} finally {
  rmSync(tmp, { recursive: true, force: true });
}
