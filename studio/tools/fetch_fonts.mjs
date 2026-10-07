// node tools/fetch_fonts.mjs
// タイムラインで使う文字だけを含む Noto Serif JP / Noto Sans JP を Google Fonts から取り、fonts/ に置く。
// （curl を使うのは、この環境のプロキシと証明書を正しく扱えるため）
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const src = readFileSync(resolve(STUDIO, 'build/timeline.js'), 'utf8');
const TL = JSON.parse(src.replace(/^window\.TIMELINE = /, '').replace(/;\s*$/, ''));
const ascii = Array.from({ length: 95 }, (_, i) => String.fromCharCode(32 + i)).join('');
const text = [...new Set((ascii + JSON.stringify(TL.scenes) + Object.keys(TL.assets).join('') + '[]').split(''))].join('');
mkdirSync(resolve(STUDIO, 'fonts'), { recursive: true });

const fams = [[TL.tokens.font.display.family, TL.tokens.font.display.weight], [TL.tokens.font.text.family, TL.tokens.font.text.weight]];
let css = '';
for (const [family, weight] of fams) {
  const url = `https://fonts.googleapis.com/css2?family=${encodeURIComponent(family).replace(/%20/g, '+')}:wght@${weight}&text=${encodeURIComponent(text)}`;
  const face = execFileSync('curl', ['-sS', '-A', 'Mozilla/5.0 Chrome/120', url]).toString();
  const files = [...face.matchAll(/url\((https:\/\/fonts\.gstatic\.com[^)]+)\)/g)].map(m => m[1]);
  if (!files.length) throw new Error('フォントを取得できませんでした: ' + family);
  files.forEach((u, i) => {
    const name = `${family.replace(/\s+/g, '')}-${weight}-${i}.woff2`;
    writeFileSync(resolve(STUDIO, 'fonts', name), execFileSync('curl', ['-sS', u], { maxBuffer: 50e6 }));
    css += face.replace(u, name).match(/@font-face\s*{[^}]*}/g)[i] + '\n';
  });
}
writeFileSync(resolve(STUDIO, 'fonts/fonts.css'), css);
console.log('fonts:', fams.map(f => f[0] + ' ' + f[1]).join(', '), `(${[...text].length} chars)`);
