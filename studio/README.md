# MV Studio（コードで描いて mp4 にする）

歌ってみたMVを、`window.seek(t)`（どの瞬間も時間だけで描く）→ Playwright → ffmpeg で書き出す制作環境。
ルールはリポジトリ直下の `CLAUDE.md`。ここには **確認したことだけ** を書く。

## 手順
```bash
cd studio
npm i                                            # Playwright（1.56.1）
python tools/beats.py ../audio/song.wav > build/beats.json     # 曲の拍を測る
node tools/build_timeline.mjs --lrc ../samples/sample.lrc       # タイムライン・shotlist・captions.srt
node tools/fetch_fonts.mjs                       # 使う文字だけのフォント
OPENAI_API_KEY=... node tools/gen_assets.mjs     # 画像を生成（ChatGPT / OpenAI 画像API）
node tools/critique.mjs                          # コンタクトシート・スマホテスト・機械チェック
node render.mjs --format 16x9                    # 9x16 / 1x1 / --reduced（動きを抑えた版）
node tools/mux.mjs --video out/silent_16x9.mp4 --audio ../audio/song.wav --out out/final_16x9.mp4
```
ffmpeg は `FFMPEG` 環境変数でパスを指定できる（無ければ `ffmpeg`）。

## 確認したこと（2026-10-07、この環境で実行）
- タイムライン生成: サンプル歌詞で 9 シーン、shotlist.md と captions.srt を出力
- フォント: Noto Serif JP 700 / Noto Sans JP 500 を、使う文字だけ取得して描画
- 機械チェック（critique.mjs, 下書き）: 決定性（読み直し含む）OK、点滅 0回/秒、文字を読んでいる間のカメラ静止 全行OK、文字の重なり無し、スプリング減衰比 ≥ 1、コントラスト 15.0 / 6.4 / 6.3:1
- 書き出し: 960x540・6秒の下書きを H.264 で書き出し
- 音: テスト音で loudnorm 2パス → -14.14 LUFS / トゥルーピーク -5.57 dBTP
- 素材不足のまま本番レンダーしようとすると止まる。キーが無いと画像生成は止まる

## 未確認
- 画像生成（キー未設定）、本番 1080p・60fps・サブフレーム4枚の書き出し時間と画質
- 曲での拍合わせ、音の同期、9:16 / 1:1 の本番書き出し、動きを抑えた版の通し
