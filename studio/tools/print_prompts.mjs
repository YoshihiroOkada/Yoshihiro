// node tools/print_prompts.mjs
// API を使わない方法のために、ChatGPT アプリへ貼るプロンプトを docs/asset_prompts_chatgpt.md に書き出す。
// 元は assets/asset_list.json だけ（ここで文言を足さない。直すときは asset_list.json を直して再実行）。
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const STUDIO = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const list = JSON.parse(readFileSync(resolve(STUDIO, 'assets/asset_list.json'), 'utf8'));
const shape = s => { const [w, h] = s.split('x').map(Number); return w > h ? '横長（3:2）' : w < h ? '縦長（2:3）' : '正方形（1:1）'; };
const ratio = s => { const [w, h] = s.split('x').map(Number); return w > h ? 'landscape 3:2' : w < h ? 'portrait 2:3' : 'square 1:1'; };

const out = [
  '# ChatGPT アプリで作る画像（無料の方法）',
  '',
  '`studio/assets/asset_list.json` から `node tools/print_prompts.mjs` で自動生成。手で直さない。',
  '',
  '## やり方',
  '1. ChatGPT アプリで **新しいチャット** を開き、下のプロンプトを1つずつ丸ごと貼る（1チャット1枚が崩れにくい）。',
  '2. 小物（cutout）は背景が **透明** になっているか確認。市松模様や白い背景になったら「背景を透明にして PNG で出し直して」と送る。',
  '3. 気に入らなければ「同じ指示で作り直して」。色が派手になったら「色は指定の6色だけにして」。',
  '4. 画像を保存し、ファイル名を **表の名前どおり** に変える（例: `mask.png`）。PNG のまま。',
  '5. 11枚そろったら（途中でもOK）、次のどちらかで渡す:',
  '   - このチャット（Claude）に画像を添付して送る',
  '   - GitHub のブランチ `claude/ae-utaite-mv-production-obspw6` の `studio/assets/img/` に「Add file → Upload files」',
  '6. Claude が `node tools/register_assets.mjs` で登録 → 批評ループ → 本番レンダー。',
  '',
  '| # | ファイル名 | 種類 | 形 |',
  '|---|---|---|---|',
  ...list.assets.map((a, i) => `| ${i + 1} | \`${a.id}.png\` | ${a.role === 'plate' ? '背景' : '小物（透明）'} | ${shape(a.size)} |`),
  '',
];
list.assets.forEach((a, i) => {
  const prompt = [
    `Create one image, ${ratio(a.size)}, PNG${a.role === 'cutout' ? ' with a transparent background' : ''}.`,
    a.prompt,
    a.role === 'plate' ? list.plate : list.cutout,
    list.style,
  ].join('\n');
  out.push(`## ${i + 1}. \`${a.id}.png\`（${a.role === 'plate' ? '背景' : '小物・透明'}、${shape(a.size)}）`, '', '```', prompt, '```', '');
});
writeFileSync(resolve(STUDIO, '../docs/asset_prompts_chatgpt.md'), out.join('\n'));
console.log('docs/asset_prompts_chatgpt.md に', list.assets.length, '件');
