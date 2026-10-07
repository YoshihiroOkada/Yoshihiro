# ChatGPT アプリで作る画像（無料の方法）

`studio/assets/asset_list.json` から `node tools/print_prompts.mjs` で自動生成。手で直さない。

## やり方
1. ChatGPT アプリで **新しいチャット** を開き、下のプロンプトを1つずつ丸ごと貼る（1チャット1枚が崩れにくい）。
2. 小物（cutout）は背景が **透明** になっているか確認。市松模様や白い背景になったら「背景を透明にして PNG で出し直して」と送る。
3. 気に入らなければ「同じ指示で作り直して」。色が派手になったら「色は指定の6色だけにして」。
4. 画像を保存し、ファイル名を **表の名前どおり** に変える（例: `mask.png`）。PNG のまま。
5. 11枚そろったら（途中でもOK）、次のどちらかで渡す:
   - このチャット（Claude）に画像を添付して送る
   - GitHub のブランチ `claude/ae-utaite-mv-production-obspw6` の `studio/assets/img/` に「Add file → Upload files」
6. Claude が `node tools/register_assets.mjs` で登録 → 批評ループ → 本番レンダー。

| # | ファイル名 | 種類 | 形 |
|---|---|---|---|
| 1 | `bg_graveyard.png` | 背景 | 横長（3:2） |
| 2 | `bg_ballroom.png` | 背景 | 横長（3:2） |
| 3 | `mask.png` | 小物（透明） | 正方形（1:1） |
| 4 | `tomb.png` | 小物（透明） | 縦長（2:3） |
| 5 | `cross.png` | 小物（透明） | 縦長（2:3） |
| 6 | `tree.png` | 小物（透明） | 縦長（2:3） |
| 7 | `pumpkin_lit.png` | 小物（透明） | 正方形（1:1） |
| 8 | `light.png` | 小物（透明） | 正方形（1:1） |
| 9 | `pillar.png` | 小物（透明） | 縦長（2:3） |
| 10 | `chandelier.png` | 小物（透明） | 横長（3:2） |
| 11 | `dancers.png` | 小物（透明） | 縦長（2:3） |

## 1. `bg_graveyard.png`（背景、横長（3:2））

```
Create one image, landscape 3:2, PNG.
A Halloween night graveyard on a gentle hill, a haunted mansion silhouette on the far hilltop with a few windows lit in pumpkin orange, a large pale moon in warm grey, crooked fence, distant tombstones. Quiet and lonely.
Wide establishing background plate, 3:2, empty foreground band at the bottom 20% for captions, horizon at about 60% height, nothing important in the corners.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 2. `bg_ballroom.png`（背景、横長（3:2））

```
Create one image, landscape 3:2, PNG.
Inside the same haunted mansion: a grand masquerade ballroom at night, tall arched windows showing the same moon, checkered stone floor in umber and taupe, rows of columns, heavy curtains in umber, candlelight in pumpkin orange only. Empty room waiting for dancers.
Wide establishing background plate, 3:2, empty foreground band at the bottom 20% for captions, horizon at about 60% height, nothing important in the corners.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 3. `mask.png`（小物・透明、正方形（1:1））

```
Create one image, square 1:1, PNG with a transparent background.
An elegant Venetian masquerade eye mask with feathers, in bone white and taupe with charcoal eye holes, one small pumpkin-orange gem on the forehead. Front view, slightly tilted. This is the hero object of the film.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 4. `tomb.png`（小物・透明、縦長（2:3））

```
Create one image, portrait 2:3, PNG with a transparent background.
A weathered rounded-top tombstone with a crack, in umber and taupe, no inscription.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 5. `cross.png`（小物・透明、縦長（2:3））

```
Create one image, portrait 2:3, PNG with a transparent background.
A tilted old stone cross grave marker in umber and taupe, no inscription.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 6. `tree.png`（小物・透明、縦長（2:3））

```
Create one image, portrait 2:3, PNG with a transparent background.
A bare twisted dead tree silhouette with spreading branches, in taupe line color.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 7. `pumpkin_lit.png`（小物・透明、正方形（1:1））

```
Create one image, square 1:1, PNG with a transparent background.
A carved jack-o'-lantern with a friendly-mysterious face, shell in umber and taupe, the carved eyes and mouth glowing flat pumpkin orange (flat color, no bloom).
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 8. `light.png`（小物・透明、正方形（1:1））

```
Create one image, square 1:1, PNG with a transparent background.
A single small candle flame shape in flat pumpkin orange with a bone-white core, no candle, no glow halo.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 9. `pillar.png`（小物・透明、縦長（2:3））

```
Create one image, portrait 2:3, PNG with a transparent background.
A tall classical ballroom column with simple capital and base, in umber with taupe fluting, front view.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 10. `chandelier.png`（小物・透明、横長（3:2））

```
Create one image, landscape 3:2, PNG with a transparent background.
An ornate hanging candle chandelier with curved arms in taupe, eight candles with flat pumpkin-orange flames, hanging chain at the top.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```

## 11. `dancers.png`（小物・透明、縦長（2:3））

```
Create one image, portrait 2:3, PNG with a transparent background.
A waltzing couple in masquerade masks as an elegant silhouette in taupe and umber, woman in a long ball gown, man in a tailcoat, mid-turn.
Single isolated object on a fully transparent background, centered, the whole object visible with margin, no ground shadow, no floor.
Flat 2.5D cut-paper shadow-puppet illustration with crisp edges, subtle paper grain. Strictly limited palette: warm charcoal #1C1915, dark umber #29241F, taupe line #4A433B, warm grey #A39A8E, bone white #F2EDE4, and pumpkin orange #E8823A used ONLY for light sources. No other saturated colors. No text, no letters, no logos, no neon, no glow or bloom, no lens flare, no particles, no gradient sky, not photographic, not glossy 3D.
```
