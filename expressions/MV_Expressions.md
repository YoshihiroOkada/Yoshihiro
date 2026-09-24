# MV用エクスプレッション集（コピペ用）

`MV_LyricBuilder.jsx` が自動で入れるものに加えて、手で足したいときの定番です。
すべて **日本語版AEでもそのまま動く** 書き方（エフェクトはインデックス参照）にしています。

---

## 1. ビートでスケールを跳ねさせる（位置・スケールどちらでも）

音源レイヤーを右クリック →「キーフレーム補助 → オーディオをキーフレームに変換」で
できる「オーディオ振幅」レイヤーを使います。

```js
// スケールに貼る
var amp = thisComp.layer("オーディオ振幅").effect(3)(1); // 3 = 両チャンネル
var k = linear(amp, 5, 30, 0, 12);  // 振幅 5〜30 を 0〜12% に
mul(value, 1 + k / 100)
```

> 英語版AEならレイヤー名は `"Audio Amplitude"`。

## 2. ヒット感のある減衰バウンス（マーカーごとに跳ねる）

レイヤーにマーカーを打つと、そのたびに「ボヨン」と弾みます。

```js
var amp = 25, freq = 3.5, decay = 6;
var n = marker.numKeys ? marker.nearestKey(time).index : 0;
if (n && marker.key(n).time > time) n--;
if (n > 0) {
  var t = time - marker.key(n).time;
  var s = amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t);
  add(value, [s, s, s].slice(0, value.length));
} else value;
```

## 3. 手ブレ風カメラ（カメラ位置）

```js
var f = 1.2, a = 8;
wiggle(f, a)
```

## 4. グリッチ（位置に貼る・ときどき横にズレる）

```js
var rate = 8;              // 1秒あたりの判定回数
seedRandom(Math.floor(time * rate), true);
random() < 0.15 ? add(value, [random(-40, 40), 0, 0].slice(0, value.length)) : value
```

## 5. 1文字ずつタイプライター（ソーステキスト）

```js
var cps = 18;                       // 1秒あたり文字数
var s = value.toString();
s.substr(0, Math.floor((time - inPoint) * cps))
```

## 6. テキストアニメーターの「エクスプレッションセレクター」用

`MV_LyricBuilder` が使っている方式。アニメーター → 追加 → セレクター → エクスプレッション
の「量」に貼ります（100 = アニメーターの値を全部適用、0 = 何もしない）。

```js
// 左から順に 0.05 秒ずつ遅れて、0.6 秒かけて元の位置に戻る
var d = 0.6, st = 0.05;
var p = clamp((time - inPoint - (textIndex - 1) * st) / d, 0, 1);
var a = 100 * Math.pow(1 - p, 3);   // easeOutCubic
[a, a, a]
```

ランダム順にしたいとき:

```js
seedRandom(textIndex, true);
var p = clamp((time - inPoint - random(0, 0.5)) / 0.5, 0, 1);
var a = 100 * (1 - p);
[a, a, a]
```

## 7. カメラまでの距離で自動フォーカス（カメラ → フォーカス距離）

特定の歌詞レイヤーにピントを合わせ続ける:

```js
var target = thisComp.layer("LYRIC_005");
length(toWorld([0, 0, 0]), target.toWorld(target.anchorPoint))
```

## 8. ループする浮遊（位置）

```js
var sp = 0.6, amp = 20;
add(value, [Math.sin(time * sp) * amp, Math.cos(time * sp * 1.3) * amp * 0.6, 0].slice(0, value.length))
```
