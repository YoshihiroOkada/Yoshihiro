/*
 * MV_LyricBuilder.jsx  -  歌ってみたMV用 3Dカメラ歌詞モーション自動生成 (After Effects)
 *
 * LRCファイル、または音源レイヤーに打ったマーカーから
 *   ・3D空間に歌詞テキストを配置（1文字ずつ3Dで出入り）
 *   ・3Dカメラリグが歌詞から歌詞へイージング付きで飛んでいく
 *   ・パーティクル / 被写界深度 / グロー / ビネット / シネマ帯
 *   ・MV_CONTROL ヌルのスライダーで全体を後から調整
 * を一発で組み立てます。
 *
 * 実行: ファイル > スクリプト > スクリプトファイルを実行...
 * 詳細: README.md
 */
(function () {
    var SCRIPT_NAME = "MV Lyric Builder";
    var VERSION = "1.0.0";
    var CTRL = "MV_CONTROL";
    var SETTINGS_SECTION = "MVLyricBuilder";

    var CAMERA_STYLES = [
        { key: "zigzag", label: "ジグザグ（左右に振りながら奥へ）" },
        { key: "spiral", label: "スパイラル（回転しながら奥へ）" },
        { key: "dive",   label: "ダイブ（ほぼ直進で突っ込む）" },
        { key: "turn",   label: "ターン（90°曲がり角あり）" }
    ];
    var TEXT_STYLES = [
        { key: "fly",  label: "奥から飛来（3D）" },
        { key: "drop", label: "上から回転して落下" },
        { key: "zoom", label: "ブラーズーム" }
    ];

    // =====================================================================
    // ユーティリティ
    // =====================================================================
    function trim(s) {
        return String(s).replace(/^[\s　﻿]+/, "").replace(/[\s　]+$/, "");
    }

    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function hexToRgb(hex, fallback) {
        var h = trim(hex).replace(/^#/, "");
        if (h.length === 3) {
            h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        }
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
        return [
            parseInt(h.substr(0, 2), 16) / 255,
            parseInt(h.substr(2, 2), 16) / 255,
            parseInt(h.substr(4, 2), 16) / 255
        ];
    }

    function rgba(c) { return [c[0], c[1], c[2], 1]; }

    // 再現性のある乱数（シードが同じなら同じ配置になる）
    function Rng(seed) {
        var s = Math.abs(Math.floor(seed)) % 4294967296;
        if (s === 0) s = 12345;
        this.next = function () {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }
    Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };

    function readTextFile(path) {
        var f = new File(path);
        if (!f.exists) throw new Error("ファイルが見つかりません: " + path);
        f.encoding = "UTF-8";
        if (!f.open("r")) throw new Error("ファイルを開けません: " + path);
        var s = f.read();
        f.close();
        return s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    }

    function isSpace(ch) { return ch === " " || ch === "　"; }

    // =====================================================================
    // 歌詞の読み込み
    // =====================================================================
    function parseTimeTag(tag) {
        var m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
        if (!m) return null;
        var frac = m[3] ? parseFloat("0." + m[3]) : 0;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
    }

    // [mm:ss.xx]歌詞  /  [ti:曲名] [ar:歌い手]  /  1行に複数タイムタグ可
    function parseLRC(text) {
        var out = { entries: [], title: "", artist: "" };
        var rows = text.split("\n");
        for (var i = 0; i < rows.length; i++) {
            var row = trim(rows[i]);
            if (!row) continue;
            var times = [];
            var m;
            while ((m = /^\s*\[([^\]]*)\]/.exec(row)) !== null) {
                var tag = trim(m[1]);
                var t = parseTimeTag(tag);
                if (t !== null) {
                    times.push(t);
                } else {
                    var meta = /^(ti|ar)\s*:(.*)$/i.exec(tag);
                    if (meta) {
                        if (meta[1].toLowerCase() === "ti") out.title = trim(meta[2]);
                        else out.artist = trim(meta[2]);
                    }
                }
                row = row.substr(m[0].length);
            }
            if (!times.length) continue;
            // 拡張LRCの単語タイム <mm:ss.xx> は除去
            var body = trim(row.replace(/<\d+:\d+(?:[.:]\d+)?>/g, ""));
            for (var j = 0; j < times.length; j++) out.entries.push({ time: times[j], text: body });
        }
        out.entries.sort(function (a, b) { return a.time - b.time; });
        return out;
    }

    // マーカー1個 = 1行。マーカーのコメントがあればそれを歌詞に、
    // 無ければ歌詞.txt を上から順に割り当てる。コメント "-" は「歌詞を消す」マーカー。
    function entriesFromMarkers(layer, txtPath) {
        var lines = [];
        if (txtPath) {
            var raw = readTextFile(txtPath).split("\n");
            for (var i = 0; i < raw.length; i++) {
                var s = trim(raw[i]);
                if (s) lines.push(s);
            }
        }
        var mk = layer.property("ADBE Marker");
        if (!mk || mk.numKeys === 0) throw new Error("選択レイヤーにマーカーがありません。\n再生しながらテンキーの * でマーカーを打ってください。");
        var entries = [];
        var li = 0;
        for (var k = 1; k <= mk.numKeys; k++) {
            var c = trim(mk.keyValue(k).comment);
            var text;
            if (c) {
                text = c;
            } else {
                text = li < lines.length ? lines[li] : "";
                li++;
            }
            entries.push({ time: mk.keyTime(k), text: text });
        }
        return entries;
    }

    // "/" で手動改行。無ければ長い行だけ真ん中付近で自動改行。
    function formatLyric(s, maxChars) {
        if (/[\/／]/.test(s)) {
            var parts = s.split(/[\/／]/);
            for (var i = 0; i < parts.length; i++) parts[i] = trim(parts[i]);
            return parts.join("\r");
        }
        if (maxChars > 0 && s.length > maxChars) {
            var mid = Math.floor(s.length / 2);
            var best = -1;
            for (var d = 0; d <= mid; d++) {
                var a = mid - d, b = mid + d;
                if (a > 0 && isSpace(s.charAt(a))) { best = a; break; }
                if (b < s.length - 1 && isSpace(s.charAt(b))) { best = b; break; }
            }
            if (best > 0 && Math.abs(best - mid) <= s.length * 0.3) {
                return trim(s.substr(0, best)) + "\r" + trim(s.substr(best + 1));
            }
            var half = Math.ceil(s.length / 2);
            return s.substr(0, half) + "\r" + s.substr(half);
        }
        return s;
    }

    // 表示する行のリスト {start, end, text, emph} を作る
    function buildItems(entries, o) {
        var items = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var txt = trim(e.text);
            if (txt === "-") txt = "";
            if (!txt) continue;

            var next = null;
            for (var j = i + 1; j < entries.length; j++) {
                if (entries[j].time > e.time + 0.001) { next = entries[j].time; break; }
            }
            var emph = false;
            var first = txt.charAt(0);
            if (first === "!" || first === "！") {
                emph = true;
                txt = trim(txt.substr(1));
                if (!txt) continue;
            }
            txt = formatLyric(txt, o.maxChars);

            // 同じ時刻の行は1枚にまとめる
            var prev = items.length ? items[items.length - 1] : null;
            if (prev && Math.abs(prev.start - e.time) < 0.001) {
                prev.text += "\r" + txt;
                prev.emph = prev.emph || emph;
                continue;
            }
            items.push({
                start: e.time,
                end: next !== null ? next : e.time + o.lastLineDur,
                text: txt,
                emph: emph
            });
        }
        return items;
    }

    // =====================================================================
    // カメラの通り道（歌詞を置く場所）
    // =====================================================================
    function computeStops(n, style, spacing, rng) {
        var stops = [];
        var yaw = 0;
        var cur = [0, 0, 0];
        for (var i = 0; i < n; i++) {
            var p, r;
            if (style === "spiral") {
                var ang = i * 55 * Math.PI / 180;
                p = [Math.cos(ang) * 420, Math.sin(ang) * 300, i * spacing * 0.8];
                r = [0, Math.sin(i * 1.3) * 14, i * 28];
            } else if (style === "dive") {
                p = [rng.range(-160, 160), rng.range(-110, 110), i * spacing * 1.2];
                r = [rng.range(-6, 6), rng.range(-10, 10), rng.range(-5, 5)];
            } else if (style === "turn") {
                if (i > 0) {
                    if (rng.next() < 0.4) yaw += (rng.next() < 0.5 ? -90 : 90);
                    else yaw += rng.range(-20, 20);
                    var yr = yaw * Math.PI / 180;
                    cur = [cur[0] + Math.sin(yr) * spacing, rng.range(-150, 150), cur[2] + Math.cos(yr) * spacing];
                }
                p = [cur[0], cur[1], cur[2]];
                r = [rng.range(-6, 6), yaw, rng.range(-6, 6)];
            } else { // zigzag
                var side = (i % 2 === 0) ? -1 : 1;
                p = [side * rng.range(250, 620), rng.range(-200, 200), i * spacing];
                r = [rng.range(-10, 10), -side * rng.range(18, 36), rng.range(-8, 8)];
            }
            stops.push({ p: p, r: r });
        }
        return stops;
    }

    // =====================================================================
    // AE ヘルパー
    // =====================================================================
    function tr(layer) { return layer.property("ADBE Transform Group"); }

    function addFx(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) fx.name = name;
        return fx;
    }

    function addSlider(layer, name, value) {
        var fx = addFx(layer, "ADBE Slider Control", name);
        fx.property(1).setValue(value);
        return fx;
    }

    // エフェクトのパラメータを matchName → インデックスの順で探して設定（日本語版AEでも動く）
    function fxProp(fx, matchName, index) {
        var p = null;
        try { p = fx.property(matchName); } catch (e) {}
        if (!p) { try { p = fx.property(index); } catch (e2) {} }
        return p;
    }

    function setFx(fx, matchName, index, value) {
        try {
            var p = fxProp(fx, matchName, index);
            if (p) p.setValue(value);
        } catch (e) {}
    }

    function addEllipseMask(layer, cx, cy, mw, mh, feather, inverted) {
        var k = 0.5523;
        var s = new Shape();
        s.vertices = [[cx, cy - mh / 2], [cx + mw / 2, cy], [cx, cy + mh / 2], [cx - mw / 2, cy]];
        s.inTangents = [[-k * mw / 2, 0], [0, -k * mh / 2], [k * mw / 2, 0], [0, k * mh / 2]];
        s.outTangents = [[k * mw / 2, 0], [0, k * mh / 2], [-k * mw / 2, 0], [0, -k * mh / 2]];
        s.closed = true;
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(s);
        if (feather) m.property("ADBE Mask Feather").setValue([feather, feather]);
        if (inverted) m.inverted = true;
        return m;
    }

    function applyEase(prop, kinds, spatial) {
        for (var k = 1; k <= prop.numKeys; k++) {
            var arrive = kinds[k - 1] === "arrive";
            var inE = new KeyframeEase(0, arrive ? 88 : 30);
            var outE = new KeyframeEase(0, arrive ? 30 : 65);
            prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            prop.setTemporalEaseAtKey(k, [inE], [outE]);
            if (spatial) {
                prop.setSpatialAutoBezierAtKey(k, false);
                prop.setSpatialContinuousAtKey(k, false);
                prop.setSpatialTangentsAtKey(k, [0, 0, 0], [0, 0, 0]);
            }
        }
    }

    // =====================================================================
    // エクスプレッション（ASCII名＋インデックス参照なので日本語版AEでもOK）
    // =====================================================================
    var CTRL_REF = 'var c = thisComp.layer("' + CTRL + '");';

    var BEAT_FN = [
        'function mvBeat(c) {',
        '  try {',
        '    var L = c.effect("Beat Layer")(1);',
        '    if (L == null || L.index == c.index) return 0;',
        '    return linear(L.effect(3)(1), c.effect("Beat Threshold")(1), c.effect("Beat Max")(1), 0, 1);',
        '  } catch (err) { return 0; }',
        '}'
    ].join("\n");

    function staggerExpr(prefix) {
        return 'Math.min(c.effect("' + prefix + ' Stagger")(1), c.effect("Max Spread")(1) / Math.max(textTotal, 1))';
    }

    var EXPR_IN = [
        CTRL_REF,
        'var d = Math.max(c.effect("IN Duration")(1), 0.001);',
        'var st = ' + staggerExpr("IN") + ';',
        'var p = clamp((time - thisLayer.inPoint - (textIndex - 1) * st) / d, 0, 1);',
        'var a = 100 * Math.pow(1 - p, 3);',
        '[a, a, a]'
    ].join("\n");

    var EXPR_FLASH = [
        CTRL_REF,
        'var d = Math.max(c.effect("IN Duration")(1), 0.001);',
        'var st = ' + staggerExpr("IN") + ';',
        'var p = clamp((time - thisLayer.inPoint - (textIndex - 1) * st) / d, 0, 1);',
        'var a = 100 * Math.sin(Math.PI * p);',
        '[a, a, a]'
    ].join("\n");

    var EXPR_OUT = [
        CTRL_REF,
        'var d = Math.max(c.effect("OUT Duration")(1), 0.001);',
        'var st = ' + staggerExpr("OUT") + ';',
        'var s = thisLayer.outPoint - d - (textTotal - textIndex) * st;',
        'var p = clamp((time - s) / d, 0, 1);',
        'var a = 100 * p * p * p;',
        '[a, a, a]'
    ].join("\n");

    function exprTextScale(emph) {
        var lines = [BEAT_FN, CTRL_REF,
            'var k = 1 + c.effect("Text Push %/s")(1) / 100 * Math.max(0, time - inPoint);'];
        if (emph) lines.push('k *= 1 + mvBeat(c) * c.effect("Emphasis Beat %")(1) / 100;');
        lines.push('mul(value, k)');
        return lines.join("\n");
    }

    var EXPR_CAM_POS = [
        BEAT_FN, CTRL_REF,
        'var w = wiggle(c.effect("Shake Freq")(1), c.effect("Shake Amount")(1));',
        'add(w, [0, 0, mvBeat(c) * c.effect("Beat Punch")(1)])'
    ].join("\n");

    var EXPR_FOCUS = 'length(thisLayer.transform.position)';

    function exprSway(speed, phase, mulv) {
        return CTRL_REF + '\nvalue + Math.sin(time * ' + speed + ' + ' + phase + ') * c.effect("Sway")(1) * ' + mulv;
    }

    var EXPR_GLOW = [BEAT_FN, CTRL_REF, 'value + mvBeat(c) * c.effect("Beat Glow")(1)'].join("\n");

    var EXPR_DUST = [
        'seedRandom(index, true);',
        'var sp = random(4, 20), sw = random(10, 40), fr = random(0.2, 0.6), ph = random(6.28);',
        'add(value, [Math.sin(time * fr + ph) * sw, -time * sp, 0])'
    ].join("\n");

    // 立ち絵のふわふわ呼吸（レイヤー自身のスライダーで調整）
    var EXPR_TACHIE_POS = [
        'var a = effect("Float Amount")(1), s = effect("Float Speed")(1);',
        'add(value, [0, Math.sin(time * s * 2 * Math.PI) * a, 0])'
    ].join("\n");

    var EXPR_TACHIE_SCALE = [
        'var k = 1 + effect("Breath %")(1) / 100 * Math.sin(time * effect("Float Speed")(1) * 2 * Math.PI * 1.3 + 1);',
        '[value[0], value[1] * k, value[2]]'
    ].join("\n");

    var EXPR_TACHIE_ROT = 'value + Math.sin(time * effect("Float Speed")(1) * Math.PI + 2) * effect("Sway°")(1)';

    // =====================================================================
    // テキストアニメーター（Expression Selector で制御）
    // =====================================================================
    function textAnimators(layer) {
        return layer.property("ADBE Text Properties").property("ADBE Text Animators");
    }

    function addAnimator(layer, name, specs, amountExpr) {
        var a = textAnimators(layer).addProperty("ADBE Text Animator");
        a.name = name;
        var idx = a.propertyIndex;
        var i;
        // addProperty の後は古い参照が無効になるので毎回取り直す
        for (i = 0; i < specs.length; i++) {
            textAnimators(layer).property(idx).property("ADBE Text Animator Properties").addProperty(specs[i][0]);
        }
        for (i = 0; i < specs.length; i++) {
            try {
                textAnimators(layer).property(idx).property("ADBE Text Animator Properties").property(specs[i][0]).setValue(specs[i][1]);
            } catch (e) {}
        }
        textAnimators(layer).property(idx).property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
        var sel = textAnimators(layer).property(idx).property("ADBE Text Selectors").property(1);
        var amt = null;
        try { amt = sel.property("ADBE Text Expressible Amount"); } catch (e2) {}
        if (!amt) {
            for (i = 1; i <= sel.numProperties; i++) {
                if (/Amount/i.test(sel.property(i).matchName)) { amt = sel.property(i); break; }
            }
        }
        if (amt) amt.expression = amountExpr;
    }

    function inSpecs(style) {
        if (style === "drop") {
            return [
                ["ADBE Text Position 3D", [0, -140, 0]],
                ["ADBE Text Rotation X", -90],
                ["ADBE Text Opacity", 0],
                ["ADBE Text Blur", [8, 8]]
            ];
        }
        if (style === "zoom") {
            return [
                ["ADBE Text Scale 3D", [260, 260, 100]],
                ["ADBE Text Opacity", 0],
                ["ADBE Text Blur", [45, 45]]
            ];
        }
        return [
            ["ADBE Text Position 3D", [0, 40, 700]],
            ["ADBE Text Rotation Y", 80],
            ["ADBE Text Opacity", 0],
            ["ADBE Text Blur", [20, 20]]
        ];
    }

    var OUT_SPECS = [
        ["ADBE Text Position 3D", [0, -30, -350]],
        ["ADBE Text Opacity", 0],
        ["ADBE Text Blur", [30, 30]]
    ];

    // =====================================================================
    // 歌詞テキストレイヤー
    // =====================================================================
    function makeLyricLayer(comp, str, o, sizeMul, color, flashColor, emph, name) {
        var L = comp.layers.addText(str);
        L.name = name;
        var tp = L.property("ADBE Text Properties").property("ADBE Text Document");
        var td = tp.value;
        try { td.resetCharStyle(); } catch (e) {}
        td.fontSize = Math.round(o.fontSize * sizeMul);
        td.applyFill = true;
        td.fillColor = color;
        td.applyStroke = false;
        td.tracking = 60;
        td.justification = ParagraphJustification.CENTER_JUSTIFY;
        if (o.font) { try { td.font = o.font; } catch (e2) {} }
        tp.setValue(td);

        L.threeDLayer = true;
        try { L.threeDPerChar = true; } catch (e3) {}

        // アンカーポイントを文字の中央へ
        var r = L.sourceRectAtTime(0, false);
        tr(L).property("ADBE Anchor Point").setValue([r.left + r.width / 2, r.top + r.height / 2, 0]);

        addAnimator(L, "IN", inSpecs(o.textStyle), EXPR_IN);
        addAnimator(L, "FLASH", [["ADBE Text Fill Color", rgba(flashColor)]], EXPR_FLASH);
        addAnimator(L, "OUT", OUT_SPECS, EXPR_OUT);

        tr(L).property("ADBE Scale").expression = exprTextScale(emph);
        L.motionBlur = o.motionBlur;
        return L;
    }

    function placeLayer(L, pos, rot, tIn, tOut) {
        tr(L).property("ADBE Position").setValue(pos);
        tr(L).property("ADBE Rotate X").setValue(rot[0]);
        tr(L).property("ADBE Rotate Y").setValue(rot[1]);
        tr(L).property("ADBE Rotate Z").setValue(rot[2]);
        L.inPoint = Math.max(0, tIn);
        L.outPoint = tOut;
    }

    // =====================================================================
    // 組み立て本体
    // =====================================================================
    function buildInner(o, proj) {
        var entries;
        var title = o.title, artist = o.artist;
        var audioItem = null, audioStart = 0;

        if (o.mode === "lrc") {
            var lrc = parseLRC(readTextFile(o.lyricsPath));
            entries = lrc.entries;
            if (!title) title = lrc.title;
            if (!artist) artist = lrc.artist;
        } else {
            entries = entriesFromMarkers(o.markerLayer, o.lyricsPath);
            if (o.markerLayer.source && o.markerLayer.hasAudio) {
                audioItem = o.markerLayer.source;
                audioStart = o.markerLayer.startTime;
            }
        }

        var items = buildItems(entries, o);
        if (!items.length) throw new Error("表示できる歌詞が見つかりませんでした。ファイルの形式を確認してください。");

        var folder = proj.items.addFolder(o.compName + "_parts");
        if (!audioItem && o.audioPath) {
            audioItem = proj.importFile(new ImportOptions(new File(o.audioPath)));
            audioItem.parentFolder = folder;
        }

        var W = o.width, H = o.height, cx = W / 2, cy = H / 2;
        var lastEnd = items[items.length - 1].end;
        var dur = Math.max(lastEnd + 2, audioItem ? audioStart + audioItem.duration : 0);
        var fr = 1 / o.fps;
        var rng = new Rng(o.seed);

        var comp = proj.items.addComp(o.compName, W, H, 1, dur, o.fps);
        comp.bgColor = [0, 0, 0];

        var textColor = hexToRgb(o.textColor, [1, 1, 1]);
        var accent = hexToRgb(o.accentColor, [1, 0.25, 0.45]);
        var bgColor = hexToRgb(o.bgColor, [0.04, 0.06, 0.15]);

        // --- コントロール（エクスプレッションが参照するので最初に作る） ---
        var ctrl = comp.layers.addNull(dur);
        ctrl.name = CTRL;
        ctrl.label = 2;
        addSlider(ctrl, "IN Duration", 0.7);
        addSlider(ctrl, "IN Stagger", 0.045);
        addSlider(ctrl, "OUT Duration", 0.45);
        addSlider(ctrl, "OUT Stagger", 0.02);
        addSlider(ctrl, "Max Spread", 0.9);
        addSlider(ctrl, "Text Push %/s", 2.5);
        addSlider(ctrl, "Shake Amount", 5);
        addSlider(ctrl, "Shake Freq", 1.2);
        addSlider(ctrl, "Sway", 2.5);
        addFx(ctrl, "ADBE Layer Control", "Beat Layer");
        addSlider(ctrl, "Beat Threshold", 5);
        addSlider(ctrl, "Beat Max", 30);
        addSlider(ctrl, "Beat Punch", 150);
        addSlider(ctrl, "Beat Glow", 1.2);
        addSlider(ctrl, "Emphasis Beat %", 6);

        // --- 音源 ---
        if (audioItem) {
            var aL = comp.layers.add(audioItem);
            aL.startTime = audioStart;
            aL.name = "AUDIO";
            if (aL.hasVideo) aL.enabled = false;
        }

        // --- 背景グラデーション（2D） ---
        var bg = comp.layers.addSolid([0, 0, 0], "BG_GRADIENT", W, H, 1, dur);
        var ramp = addFx(bg, "ADBE Ramp");
        setFx(ramp, "ADBE Ramp-0001", 1, [cx, H * 0.42]);
        setFx(ramp, "ADBE Ramp-0002", 2, rgba(bgColor));
        setFx(ramp, "ADBE Ramp-0003", 3, [W * 1.05, H * 1.15]);
        setFx(ramp, "ADBE Ramp-0004", 4, [0, 0, 0, 1]);
        setFx(ramp, "ADBE Ramp-0005", 5, 2);

        // --- 歌詞の配置を計算 ---
        var useTitle = o.titleCard && (title || artist) && items[0].start >= 1.5;
        var raw = computeStops(items.length, o.cameraStyle, o.spacing, rng);
        var stops = [];
        if (useTitle) {
            var p0 = raw[0].p;
            stops.push({ t: 0, p: [p0[0], p0[1], p0[2] - o.spacing], r: [0, 0, 0], title: true });
        }
        for (var i = 0; i < items.length; i++) {
            stops.push({ t: items[i].start, p: raw[i].p, r: raw[i].r, item: items[i] });
        }
        for (i = 0; i < stops.length; i++) {
            stops[i].world = [cx + stops[i].p[0], cy + stops[i].p[1], stops[i].p[2]];
        }

        // --- パーティクル（奥行きを感じさせる浮遊ドット） ---
        if (o.dust && o.dustCount > 0) {
            var dot = proj.items.addComp("MV_DOT", 64, 64, 1, dur, o.fps);
            dot.parentFolder = folder;
            var dotSolid = dot.layers.addSolid([1, 1, 1], "dot", 64, 64, 1, dur);
            addEllipseMask(dotSolid, 32, 32, 60, 60, 20, false);

            var mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
            for (i = 0; i < stops.length; i++) {
                for (var a = 0; a < 3; a++) {
                    mn[a] = Math.min(mn[a], stops[i].world[a]);
                    mx[a] = Math.max(mx[a], stops[i].world[a]);
                }
            }
            var margin = 1400;
            for (i = 0; i < o.dustCount; i++) {
                var dl = comp.layers.add(dot, dur);
                dl.name = "DUST_" + (i + 1);
                dl.threeDLayer = true;
                dl.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
                tr(dl).property("ADBE Position").setValue([
                    rng.range(mn[0] - margin, mx[0] + margin),
                    rng.range(mn[1] - margin * 0.7, mx[1] + margin * 0.7),
                    rng.range(mn[2] - 800, mx[2] + 2500)
                ]);
                var bokeh = rng.next() < 0.12;
                var sc = bokeh ? rng.range(250, 600) : rng.range(20, 120);
                tr(dl).property("ADBE Scale").setValue([sc, sc, sc]);
                tr(dl).property("ADBE Opacity").setValue(bokeh ? rng.range(12, 30) : rng.range(30, 85));
                tr(dl).property("ADBE Position").expression = EXPR_DUST;
                dl.shy = true;
            }
            comp.hideShyLayers = true;
        }

        // --- 歌詞テキスト ---
        var PREROLL = 0.12, OUT_OVERLAP = 0.25;
        for (i = 0; i < stops.length; i++) {
            var S = stops[i];
            if (S.title) {
                var tOut = items[0].start + OUT_OVERLAP;
                if (title) {
                    var TL = makeLyricLayer(comp, title, o, 1.4, textColor, accent, false, "TITLE");
                    placeLayer(TL, S.world, S.r, 0, tOut);
                }
                if (artist) {
                    var AL = makeLyricLayer(comp, artist, o, 0.5, accent, textColor, false, "ARTIST");
                    var yOff = title ? o.fontSize * 1.25 : 0;
                    placeLayer(AL, [S.world[0], S.world[1] + yOff, S.world[2]], S.r, 0, tOut);
                }
                continue;
            }
            var it = S.item;
            var num3 = ("00" + (i + (useTitle ? 0 : 1))).slice(-3);
            var L = makeLyricLayer(comp, it.text, o,
                it.emph ? 1.35 : 1,
                it.emph ? accent : textColor,
                it.emph ? textColor : accent,
                it.emph, "LYRIC_" + num3 + (it.emph ? "_!" : ""));
            placeLayer(L, S.world, S.r, it.start - PREROLL, it.end + OUT_OVERLAP);
        }

        // --- カメラリグ ---
        var dist = Math.round(W * 0.95);
        var rig = comp.layers.addNull(dur);
        rig.name = "CAM_RIG";
        rig.threeDLayer = true;
        rig.label = 11;
        tr(rig).property("ADBE Anchor Point").setValue([0, 0, 0]);

        var cam = comp.layers.addCamera("MV_CAMERA", [cx, cy]);
        cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        cam.parent = rig;
        tr(cam).property("ADBE Position").setValue([0, 0, -dist]);
        tr(cam).property("ADBE Orientation").setValue([0, 0, 0]);
        tr(cam).property("ADBE Rotate X").setValue(0);
        tr(cam).property("ADBE Rotate Y").setValue(0);
        tr(cam).property("ADBE Rotate Z").setValue(0);
        tr(cam).property("ADBE Position").expression = EXPR_CAM_POS;

        var camOpt = cam.property("ADBE Camera Options Group");
        camOpt.property("ADBE Camera Zoom").setValue(dist);
        if (o.dof) {
            camOpt.property("ADBE Camera Depth of Field").setValue(1);
            camOpt.property("ADBE Camera Focus Distance").setValue(dist);
            camOpt.property("ADBE Camera Focus Distance").expression = EXPR_FOCUS;
            camOpt.property("ADBE Camera Aperture").setValue(60);
            camOpt.property("ADBE Camera Blur Level").setValue(100);
        }

        // 各歌詞の位置へ「到着 → 停留 → 出発」のキーフレーム
        var times = [], P = [], RX = [], RY = [], RZ = [], kinds = [];
        function key(t, pos, rot, kind) {
            if (times.length && t <= times[times.length - 1] + fr) t = times[times.length - 1] + fr;
            times.push(t); P.push(pos); RX.push(rot[0]); RY.push(rot[1]); RZ.push(rot[2]); kinds.push(kind);
        }
        for (i = 0; i < stops.length; i++) {
            var st = stops[i];
            key(st.t, st.world, st.r, "arrive");
            if (i < stops.length - 1) {
                var nt = stops[i + 1].t;
                var T = Math.min(o.transition, (nt - st.t) * 0.7);
                var drift = (i % 2 ? 1 : -1) * 2;
                key(nt - T, st.world, [st.r[0], st.r[1], st.r[2] + drift], "depart");
            }
        }
        var rigPos = tr(rig).property("ADBE Position");
        rigPos.setValuesAtTimes(times, P);
        applyEase(rigPos, kinds, true);
        var rotNames = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
        var rotVals = [RX, RY, RZ];
        for (i = 0; i < 3; i++) {
            var rp = tr(rig).property(rotNames[i]);
            rp.setValuesAtTimes(times, rotVals[i]);
            applyEase(rp, kinds, false);
        }
        tr(rig).property("ADBE Rotate Y").expression = exprSway(0.7, 0, 1);
        tr(rig).property("ADBE Rotate Z").expression = exprSway(0.45, 1, 0.5);

        // --- 立ち絵（カメラに固定して常に画面の横にいる） ---
        if (o.tachiePath) {
            var tItem = proj.importFile(new ImportOptions(new File(o.tachiePath)));
            tItem.parentFolder = folder;
            var tc = comp.layers.add(tItem, dur);
            tc.name = "TACHIE";
            addSlider(tc, "Float Amount", 10);
            addSlider(tc, "Float Speed", 0.35);
            addSlider(tc, "Breath %", 1.2);
            addSlider(tc, "Sway°", 0.6);
            tc.threeDLayer = true;
            tc.parent = cam;
            var zBack = 400; // 歌詞より少し奥 → 歌詞が立ち絵の上に重なって読みやすい
            var kz = (dist + zBack) / dist;
            var side = o.tachieSide === "left" ? -1 : 1;
            var tsc = (H * o.tachieHeight / Math.max(1, tItem.height)) * 100 * kz;
            tr(tc).property("ADBE Anchor Point").setValue([tItem.width / 2, tItem.height, 0]);
            tr(tc).property("ADBE Orientation").setValue([0, 0, 0]);
            tr(tc).property("ADBE Rotate X").setValue(0);
            tr(tc).property("ADBE Rotate Y").setValue(0);
            tr(tc).property("ADBE Rotate Z").setValue(0);
            tr(tc).property("ADBE Position").setValue([side * W * 0.3 * kz, (H / 2 + 30) * kz, dist + zBack]);
            tr(tc).property("ADBE Scale").setValue([tsc, tsc, 100]);
            tr(tc).property("ADBE Position").expression = EXPR_TACHIE_POS;
            tr(tc).property("ADBE Scale").expression = EXPR_TACHIE_SCALE;
            tr(tc).property("ADBE Rotate Z").expression = EXPR_TACHIE_ROT;
            tc.motionBlur = false;
        }

        // --- 仕上げ（グロー / グレイン / ビネット） ---
        if (o.grade) {
            var adj = comp.layers.addSolid([1, 1, 1], "FX_GRADE", W, H, 1, dur);
            adj.adjustmentLayer = true;
            var glow = addFx(adj, "ADBE Glo2");
            setFx(glow, "ADBE Glo2-0002", 2, 55);
            setFx(glow, "ADBE Glo2-0003", 3, 60);
            setFx(glow, "ADBE Glo2-0004", 4, 0.9);
            try { fxProp(glow, "ADBE Glo2-0004", 4).expression = EXPR_GLOW; } catch (e) {}
            var noise = addFx(adj, "ADBE Noise");
            setFx(noise, "ADBE Noise-0001", 1, 3);

            var vig = comp.layers.addSolid([0, 0, 0], "VIGNETTE", W, H, 1, dur);
            addEllipseMask(vig, cx, cy, W * 1.1, H * 1.3, W * 0.35, true);
            tr(vig).property("ADBE Opacity").setValue(70);
        }

        // --- シネマ帯 ---
        if (o.letterbox) {
            var bh = Math.round(H * 0.09);
            var lbT = comp.layers.addSolid([0, 0, 0], "LETTERBOX_TOP", W, bh, 1, dur);
            tr(lbT).property("ADBE Position").setValue([cx, bh / 2]);
            var lbB = comp.layers.addSolid([0, 0, 0], "LETTERBOX_BOTTOM", W, bh, 1, dur);
            tr(lbB).property("ADBE Position").setValue([cx, H - bh / 2]);
        }

        ctrl.moveToBeginning();
        comp.motionBlur = o.motionBlur;
        comp.resolutionFactor = [2, 2];
        comp.time = items[0].start;
        comp.openInViewer();

        return { comp: comp, lines: items.length };
    }

    // =====================================================================
    // 設定の保存 / 読み込み
    // =====================================================================
    var DEFAULTS = {
        mode: "lrc", lyricsPath: "", audioPath: "",
        compName: "MV_Lyrics", width: "1920", height: "1080", fps: "30",
        font: ($.os.indexOf("Windows") >= 0) ? "YuGothic-Bold" : "HiraginoSans-W7",
        fontSize: "96", textColor: "#FFFFFF", accentColor: "#FF3D7F", bgColor: "#0B1026",
        cameraStyle: "zigzag", textStyle: "fly",
        spacing: "2400", transition: "0.8", maxChars: "16", seed: "7",
        tachiePath: "", tachieSide: "right", tachieHeight: "0.95",
        titleCard: "1", dust: "1", dustCount: "120", dof: "1", motionBlur: "1", letterbox: "0", grade: "1",
        title: "", artist: ""
    };

    function loadSettings() {
        var s = {};
        for (var k in DEFAULTS) {
            s[k] = DEFAULTS[k];
            try {
                if (app.settings.haveSetting(SETTINGS_SECTION, k)) s[k] = app.settings.getSetting(SETTINGS_SECTION, k);
            } catch (e) {}
        }
        return s;
    }

    function saveSettings(s) {
        for (var k in s) {
            try { app.settings.saveSetting(SETTINGS_SECTION, k, String(s[k])); } catch (e) {}
        }
    }

    function indexOfKey(list, key) {
        for (var i = 0; i < list.length; i++) if (list[i].key === key) return i;
        return 0;
    }

    function labels(list) {
        var r = [];
        for (var i = 0; i < list.length; i++) r.push(list[i].label);
        return r;
    }

    // =====================================================================
    // ダイアログ
    // =====================================================================
    function showDialog() {
        var S = loadSettings();
        var win = new Window("dialog", SCRIPT_NAME + " v" + VERSION);
        win.orientation = "column";
        win.alignChildren = ["fill", "top"];

        function row(parent) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            return g;
        }
        function field(parent, label, value, chars) {
            parent.add("statictext", undefined, label);
            var et = parent.add("edittext", undefined, value);
            et.characters = chars;
            return et;
        }
        function browse(parent, et, prompt) {
            var b = parent.add("button", undefined, "参照...");
            b.onClick = function () {
                var f = File.openDialog(prompt);
                if (f) et.text = f.fsName;
            };
        }

        // ① 歌詞
        var p1 = win.add("panel", undefined, "① 歌詞とタイミング");
        p1.alignChildren = ["left", "top"];
        var rbLrc = p1.add("radiobutton", undefined, "LRCファイルから作る　[mm:ss.xx]歌詞");
        var rbMk = p1.add("radiobutton", undefined, "選択中レイヤーのマーカーから作る（＋歌詞.txt 任意）");
        rbLrc.value = S.mode !== "markers";
        rbMk.value = !rbLrc.value;
        var g = row(p1);
        var etLyr = field(g, "歌詞ファイル:", S.lyricsPath, 34);
        browse(g, etLyr, "歌詞ファイル (.lrc / .txt) を選択");

        // ② 音源
        var p2 = win.add("panel", undefined, "② 音源（任意・マーカーモードでは選択レイヤーを使用）");
        p2.alignChildren = ["left", "top"];
        g = row(p2);
        var etAud = field(g, "音源ファイル:", S.audioPath, 34);
        browse(g, etAud, "音源ファイルを選択");

        // ②' 立ち絵
        var p2b = win.add("panel", undefined, "②' 立ち絵（任意・PNG/PSD）");
        p2b.alignChildren = ["left", "top"];
        g = row(p2b);
        var etTachie = field(g, "立ち絵画像:", S.tachiePath, 34);
        browse(g, etTachie, "立ち絵画像を選択");
        g = row(p2b);
        g.add("statictext", undefined, "位置:");
        var ddSide = g.add("dropdownlist", undefined, ["右", "左"]);
        ddSide.selection = S.tachieSide === "left" ? 1 : 0;
        var etTH = field(g, "高さ(画面比):", S.tachieHeight, 4);

        // ③ コンポ
        var p3 = win.add("panel", undefined, "③ コンポジション");
        p3.alignChildren = ["left", "top"];
        g = row(p3);
        var etName = field(g, "名前:", S.compName, 14);
        var etW = field(g, "幅:", S.width, 5);
        var etH = field(g, "高さ:", S.height, 5);
        g.add("statictext", undefined, "fps:");
        var fpsList = ["23.976", "24", "25", "29.97", "30", "59.94", "60"];
        var ddFps = g.add("dropdownlist", undefined, fpsList);
        ddFps.selection = 4;
        for (var i = 0; i < fpsList.length; i++) if (fpsList[i] === S.fps) ddFps.selection = i;

        // ④ スタイル
        var p4 = win.add("panel", undefined, "④ スタイル");
        p4.alignChildren = ["left", "top"];
        g = row(p4);
        var etFont = field(g, "フォント(PostScript名):", S.font, 18);
        var etSize = field(g, "サイズ:", S.fontSize, 4);
        g = row(p4);
        var etCol = field(g, "文字色:", S.textColor, 7);
        var etAcc = field(g, "アクセント色(!行):", S.accentColor, 7);
        var etBg = field(g, "背景色:", S.bgColor, 7);
        g = row(p4);
        g.add("statictext", undefined, "カメラワーク:");
        var ddCam = g.add("dropdownlist", undefined, labels(CAMERA_STYLES));
        ddCam.selection = indexOfKey(CAMERA_STYLES, S.cameraStyle);
        g.add("statictext", undefined, "文字の出方:");
        var ddTxt = g.add("dropdownlist", undefined, labels(TEXT_STYLES));
        ddTxt.selection = indexOfKey(TEXT_STYLES, S.textStyle);
        g = row(p4);
        var etSpace = field(g, "歌詞の間隔(px):", S.spacing, 5);
        var etTrans = field(g, "移動時間(秒):", S.transition, 4);
        var etMax = field(g, "自動改行(文字):", S.maxChars, 3);
        var etSeed = field(g, "シード:", S.seed, 4);

        // ⑤ オプション
        var p5 = win.add("panel", undefined, "⑤ 演出オプション");
        p5.alignChildren = ["left", "top"];
        g = row(p5);
        var cbTitle = g.add("checkbox", undefined, "冒頭にタイトル表示");
        cbTitle.value = S.titleCard === "1";
        var etTitle = field(g, "曲名:", S.title, 14);
        var etArtist = field(g, "歌い手:", S.artist, 14);
        g = row(p5);
        var cbDust = g.add("checkbox", undefined, "パーティクル");
        cbDust.value = S.dust === "1";
        var etDust = field(g, "個数:", S.dustCount, 4);
        var cbDof = g.add("checkbox", undefined, "被写界深度(ボケ)");
        cbDof.value = S.dof === "1";
        var cbMb = g.add("checkbox", undefined, "モーションブラー");
        cbMb.value = S.motionBlur === "1";
        g = row(p5);
        var cbGrade = g.add("checkbox", undefined, "グロー＋グレイン＋ビネット");
        cbGrade.value = S.grade === "1";
        var cbLb = g.add("checkbox", undefined, "シネマ帯(上下の黒帯)");
        cbLb.value = S.letterbox === "1";

        var gb = win.add("group");
        gb.alignment = "right";
        gb.add("button", undefined, "キャンセル", { name: "cancel" });
        gb.add("button", undefined, "MVを生成", { name: "ok" });

        if (win.show() !== 1) return null;

        var s = {
            mode: rbMk.value ? "markers" : "lrc",
            lyricsPath: trim(etLyr.text), audioPath: trim(etAud.text),
            tachiePath: trim(etTachie.text), tachieSide: ddSide.selection.index === 1 ? "left" : "right",
            tachieHeight: etTH.text,
            compName: trim(etName.text) || "MV_Lyrics",
            width: etW.text, height: etH.text, fps: ddFps.selection.text,
            font: trim(etFont.text), fontSize: etSize.text,
            textColor: etCol.text, accentColor: etAcc.text, bgColor: etBg.text,
            cameraStyle: CAMERA_STYLES[ddCam.selection.index].key,
            textStyle: TEXT_STYLES[ddTxt.selection.index].key,
            spacing: etSpace.text, transition: etTrans.text, maxChars: etMax.text, seed: etSeed.text,
            titleCard: cbTitle.value ? "1" : "0", dust: cbDust.value ? "1" : "0", dustCount: etDust.text,
            dof: cbDof.value ? "1" : "0", motionBlur: cbMb.value ? "1" : "0",
            letterbox: cbLb.value ? "1" : "0", grade: cbGrade.value ? "1" : "0",
            title: trim(etTitle.text), artist: trim(etArtist.text)
        };
        saveSettings(s);
        return s;
    }

    function toOptions(s) {
        return {
            mode: s.mode, lyricsPath: s.lyricsPath, audioPath: s.audioPath,
            tachiePath: s.tachiePath, tachieSide: s.tachieSide,
            tachieHeight: Math.max(0.1, Math.min(2, num(s.tachieHeight, 0.95))),
            compName: s.compName,
            width: Math.max(16, Math.round(num(s.width, 1920))),
            height: Math.max(16, Math.round(num(s.height, 1080))),
            fps: num(s.fps, 30),
            font: s.font, fontSize: Math.max(8, num(s.fontSize, 96)),
            textColor: s.textColor, accentColor: s.accentColor, bgColor: s.bgColor,
            cameraStyle: s.cameraStyle, textStyle: s.textStyle,
            spacing: Math.max(200, num(s.spacing, 2400)),
            transition: Math.max(0.1, num(s.transition, 0.8)),
            maxChars: Math.max(0, Math.round(num(s.maxChars, 16))),
            seed: num(s.seed, 7),
            lastLineDur: 4,
            titleCard: s.titleCard === "1", title: s.title, artist: s.artist,
            dust: s.dust === "1", dustCount: Math.max(0, Math.min(1000, Math.round(num(s.dustCount, 120)))),
            dof: s.dof === "1", motionBlur: s.motionBlur === "1",
            letterbox: s.letterbox === "1", grade: s.grade === "1"
        };
    }

    // =====================================================================
    // エントリーポイント
    // =====================================================================
    function main() {
        var s = showDialog();
        if (!s) return;
        var o = toOptions(s);

        if (o.mode === "lrc" && !o.lyricsPath) {
            alert("LRCファイルを指定してください。", SCRIPT_NAME);
            return;
        }
        if (o.mode === "markers") {
            var ac = app.project.activeItem;
            if (!(ac instanceof CompItem) || ac.selectedLayers.length !== 1) {
                alert("マーカーモード: マーカーを打ったレイヤー（音源）を1つだけ選択してから実行してください。", SCRIPT_NAME);
                return;
            }
            o.markerLayer = ac.selectedLayers[0];
        }

        app.beginUndoGroup(SCRIPT_NAME);
        try {
            var res = buildInner(o, app.project);
            alert("完成！ " + res.lines + " 行の歌詞を配置しました。\n\n" +
                  "・調整は「" + CTRL + "」レイヤーのエフェクトから\n" +
                  "・重いときはプレビュー解像度を下げてください", SCRIPT_NAME);
        } catch (err) {
            alert("エラー: " + err.toString() + (err.line ? "\n(line " + err.line + ")" : ""), SCRIPT_NAME);
        } finally {
            app.endUndoGroup();
        }
    }

    main();
})();
