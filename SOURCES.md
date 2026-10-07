# SOURCES（数字の出典）

画面・README・スクリプトに出てくる数字は、ここに出典があるものだけを使う。

| 数字 | 使っている場所 | 出典 |
|---|---|---|
| コントラスト 4.5:1 以上 | トークン、MV_Verify | WCAG 2.2 達成基準 1.4.3「コントラスト（最低限）」 https://www.w3.org/TR/WCAG22/#contrast-minimum |
| 点滅は1秒に3回まで | MotionTools のビートFX、MV_Verify | WCAG 2.2 達成基準 2.3.1「3回の閃光、又は閾値以下」 https://www.w3.org/TR/WCAG22/#three-flashes-or-below-threshold |
| 約 -16 LUFS（integrated）、トゥルーピーク -1.5 dBTP 以下 | README の書き出し手順 | ユーザー共有の参考プロンプト `<sound>`（docs/reference/explainer_motion_studio_prompt.md） |
| 幅 390px で読めること | トークン（字幕 64px）、MV_Verify | 参考プロンプト `<verification>` |
| 1行 8語まで・画面は2行まで | トークン、歌詞ビルダー、MV_Verify | 参考プロンプト `<scene_spec>` `<copy>` |
| コントラスト比の値（15.02 / 6.41 / 6.31 など） | brand/TOKENS.md、docs/directions.html | WCAG の相対輝度の式で計算（`mvContrast()` in scripts/MV_Tokens.jsxinc） |
| 点滅レートの検証値（2.2回/秒・2.8回/秒） | DECISIONS.md | このリポジトリでの検算（マーカー列を `mvEnv` に通して計数） |
