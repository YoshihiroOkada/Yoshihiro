// node tools/register_assets.mjs
// API を使わない方法: ChatGPT アプリで作った画像を assets/img/<id>.png として置き、これで登録する。
// （<id> は assets/asset_list.json の id。例: mask.png, bg_graveyard.png）
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const list = JSON.parse(readFileSync(resolve(STUDIO, 'assets/asset_list.json'), 'utf8'));
const manifestPath = resolve(STUDIO, 'assets/manifest.json');
const manifest = existsSync(manifestPath) ? JSON.parse(readFileSync(manifestPath, 'utf8')) : { assets: {} };
const missing = [];
for (const a of list.assets) {
  const file = resolve(STUDIO, `assets/img/${a.id}.png`);
  if (!existsSync(file)) { missing.push(a.id); continue; }
  const buf = readFileSync(file);
  if (buf.readUInt32BE(0) !== 0x89504e47) { console.warn(`${a.id}.png は PNG ではありません（PNG で保存してください）`); missing.push(a.id); continue; }
  const w = buf.readUInt32BE(16), h = buf.readUInt32BE(20);
  const alpha = buf[25] === 6 || buf[25] === 4;   // カラータイプ: 透過あり
  if (a.role === 'cutout' && !alpha) console.warn(`${a.id}.png は透過になっていません（小物は背景を透明にしてください）`);
  manifest.assets[a.id] = { file: `assets/img/${a.id}.png`, w, h, role: a.role, source: 'manual' };
}
writeFileSync(manifestPath, JSON.stringify(manifest, null, 1));
console.log(`登録 ${list.assets.length - missing.length} / ${list.assets.length}` + (missing.length ? `　未配置: ${missing.join(', ')}` : ''));
