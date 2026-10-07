/*
 * MV_LyricBuilder.jsx  -  歌ってみたMV 歌詞シーン生成 (After Effects)
 *
 * 方針は CLAUDE.md / brand/TOKENS.md（参考プロンプトを例外なしで適用）:
 *   ・画面の言葉はキーワード（錨）だけ。歌詞の全文は字幕（焼き込み）と .srt
 *   ・カメラは「移動 → 止まる → 文字が出る → 読む → 文字が消える → 移動」。読まれている間は止まる
 *   ・色・書体・寸法・動きは MV_Tokens.jsxinc からだけ取る。グロー/パーティクル/グラデーション/バウンス無し
 *   ・冒頭の絵（Question）から始まり、最後に同じ絵へ戻る（Payoff）。タイトルカードは作らない
 *   ・16:9 マスター、9:16 と 1:1 の再構成、動きを抑えた版、TIMELINE.md、captions.srt を出力
 *
 * LRC の書き方:  [00:12.34]夜を越えて {走り出した}     ← {} がキーワード（無ければ自動）
 *               [00:16.00]!届け 届け {このメロディ}    ← 先頭 ! は強調行（サビ）
 *               [00:20.00]-                            ← 歌詞を消す（間奏）
 *               字幕の改行は "/"
 */
#include "MV_Tokens.jsxinc"

(function () {
    var SCRIPT_NAME = "MV Lyric Builder";
    var VERSION = "2.0.0";
    var CTRL = "MV_CONTROL";
    var SETTINGS_SECTION = "MVLyricBuilder2";
    var T = MV_TOKENS;

    var CAMERA_STYLES = [
        { key: "zigzag", label: "ジグザグ（行ごとに左右へ構図を変える）" },
        { key: "straight", label: "直進（奥へまっすぐ）" }
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

    function rgba(c) { return [c[0], c[1], c[2], 1]; }

    function readTextFile(path) {
        var f = new File(path);
        if (!f.exists) throw new Error("ファイルが見つかりません: " + path);
        f.encoding = "UTF-8";
        if (!f.open("r")) throw new Error("ファイルを開けません: " + path);
        var s = f.read();
        f.close();
        return s.replace(/^﻿/, "").replace(/\r\n?/g, "\n");
    }

    function writeTextFile(file, text) {
        file.encoding = "UTF-8";
        if (!file.open("w")) throw new Error("書き込めません: " + file.fsName + "\n（環境設定 > スクリプトとエクスプレッション で「ファイルへの書き込みを許可」をオンに）");
        file.write(text);
        file.close();
        return file.fsName;
    }

    function isSpace(ch) { return ch === " " || ch === "　"; }

    function pad(n, w) {
        var s = String(n);
        while (s.length < w) s = "0" + s;
        return s;
    }

    function srtTime(t) {
        var ms = Math.max(0, Math.round(t * 1000));
        return pad(Math.floor(ms / 3600000), 2) + ":" + pad(Math.floor(ms / 60000) % 60, 2) + ":" +
               pad(Math.floor(ms / 1000) % 60, 2) + "," + pad(ms % 1000, 3);
    }

    function fmtTime(t) { return t.toFixed(2) + "s"; }

    // =====================================================================
    // 歌詞の読み込み（1つのタイムライン = LRC）
    // =====================================================================
    function parseTimeTag(tag) {
        var m = /^(\d+):(\d{1,2})(?:[.:](\d{1,3}))?$/.exec(tag);
        if (!m) return null;
        var frac = m[3] ? parseFloat("0." + m[3]) : 0;
        return parseInt(m[1], 10) * 60 + parseInt(m[2], 10) + frac;
    }

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
                if (t !== null) times.push(t);
                else {
                    var meta = /^(ti|ar)\s*:(.*)$/i.exec(tag);
                    if (meta) {
                        if (meta[1].toLowerCase() === "ti") out.title = trim(meta[2]);
                        else out.artist = trim(meta[2]);
                    }
                }
                row = row.substr(m[0].length);
            }
            if (!times.length) continue;
            var body = trim(row.replace(/<\d+:\d+(?:[.:]\d+)?>/g, ""));
            for (var j = 0; j < times.length; j++) out.entries.push({ time: times[j], text: body });
        }
        out.entries.sort(function (a, b) { return a.time - b.time; });
        return out;
    }

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
        var entries = [], li = 0;
        for (var k = 1; k <= mk.numKeys; k++) {
            var c = trim(mk.keyValue(k).comment);
            var text = c ? c : (li < lines.length ? lines[li] : "");
            if (!c) li++;
            entries.push({ time: mk.keyTime(k), text: text });
        }
        return entries;
    }

    // 長い文字列を 1行 maxChars 以内・最大 maxLines 行に（空白があれば空白で切る）
    function wrap(s, maxChars, maxLines) {
        var lines = [];
        var rest = trim(s);
        while (rest.length > maxChars && lines.length < maxLines - 1) {
            var cut = -1;
            for (var i = maxChars; i > maxChars * 0.5; i--) if (isSpace(rest.charAt(i))) { cut = i; break; }
            if (cut < 0) cut = maxChars;
            lines.push(trim(rest.substr(0, cut)));
            rest = trim(rest.substr(cut));
        }
        lines.push(rest);
        return lines;
    }

    // キーワード（画面の錨）: {} 指定 > 空白区切りで maxChars 以内の最後のまとまり > 行全体（2行まで）
    function pickAnchor(s, maxChars) {
        var m, found = [], re = /\{([^}]+)\}/g;
        while ((m = re.exec(s)) !== null) found.push(trim(m[1]));
        if (found.length) return { lines: found.slice(0, T.type.maxLines), auto: false };
        var plain = trim(s.replace(/[\/／]/g, " "));
        if (plain.length <= maxChars) return { lines: [plain], auto: true };
        var chunks = plain.split(/[\s　]+/);
        for (var i = chunks.length - 1; i >= 0; i--) {
            if (chunks[i].length >= 2 && chunks[i].length <= maxChars) return { lines: [chunks[i]], auto: true };
        }
        return { lines: wrap(plain, maxChars, T.type.maxLines), auto: true, tooLong: plain.length > maxChars * T.type.maxLines };
    }

    // 表示する行 {start, end, caption, anchor[], emph}
    function buildItems(entries, o) {
        var items = [];
        for (var i = 0; i < entries.length; i++) {
            var e = entries[i];
            var txt = trim(e.text);
            if (txt === "-" || !txt) continue;
            var next = null;
            for (var j = i + 1; j < entries.length; j++) {
                if (entries[j].time > e.time + 0.001) { next = entries[j].time; break; }
            }
            var emph = false;
            if (txt.charAt(0) === "!" || txt.charAt(0) === "！") { emph = true; txt = trim(txt.substr(1)); }
            if (!txt) continue;
            var anchor = pickAnchor(txt, T.type.maxChars);
            var caption = trim(txt.replace(/[{}]/g, ""));
            var prev = items.length ? items[items.length - 1] : null;
            if (prev && Math.abs(prev.start - e.time) < 0.001) continue; // 同時刻の重複は最初の行を使う
            items.push({
                start: e.time,
                end: next !== null ? next : e.time + o.lastLineDur,
                caption: caption,
                anchor: anchor.lines,
                anchorAuto: anchor.auto,
                anchorTooLong: !!anchor.tooLong,
                emph: emph
            });
        }
        return items;
    }

    // =====================================================================
    // カメラの通り道（行ごとの構図）
    // =====================================================================
    function computeStops(n, style, spacing, rng, W) {
        var k = W / 1920;
        var stops = [];
        for (var i = 0; i < n; i++) {
            var p, r;
            if (style === "straight") {
                p = [0, 0, (i + 1) * spacing];
                r = [0, 0, 0];
            } else {
                var side = (i % 2 === 0) ? -1 : 1;
                p = [side * rng.range(260, 560) * k, rng.range(-120, 120) * k, (i + 1) * spacing];
                r = [0, -side * rng.range(14, 26), 0];
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

    // 「到着」キーは長く落ち着き、「出発」キーは素直に出る。バウンスしない
    function applySettle(prop, kinds, spatial, hold) {
        for (var k = 1; k <= prop.numKeys; k++) {
            if (hold) {
                prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                continue;
            }
            var arrive = kinds[k - 1] === "arrive";
            prop.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            prop.setTemporalEaseAtKey(k,
                [new KeyframeEase(0, arrive ? T.motion.settleIn : T.motion.settleOut)],
                [new KeyframeEase(0, arrive ? T.motion.settleOut : T.motion.settleOut)]);
            if (spatial) {
                prop.setSpatialAutoBezierAtKey(k, false);
                prop.setSpatialContinuousAtKey(k, false);
                prop.setSpatialTangentsAtKey(k, [0, 0, 0], [0, 0, 0]);
            }
        }
    }

    // =====================================================================
    // エクスプレッション（時間の純関数・乱数なし）
    // =====================================================================
    var CTRL_REF = 'var c = thisComp.layer("' + CTRL + '");';

    // 登場: 文字ごとに少し遅れて、下から上がりながら現れて落ち着く（easeOutCubic、バウンス無し）
    var EXPR_IN = [
        CTRL_REF,
        'var d = Math.max(c.effect("IN Duration")(1), 0.001);',
        'var st = Math.min(c.effect("IN Stagger")(1), 0.4 / Math.max(textTotal, 1));',
        'var p = clamp((time - thisLayer.inPoint - (textIndex - 1) * st) / d, 0, 1);',
        'var a = 100 * Math.pow(1 - p, 3);',
        '[a, a, a]'
    ].join("\n");

    // 退場: 全体が同時に消える（カメラが動き出す前に読み終わっている）
    var EXPR_OUT = [
        CTRL_REF,
        'var d = Math.max(c.effect("OUT Duration")(1), 0.001);',
        'var p = clamp((time - (thisLayer.outPoint - d)) / d, 0, 1);',
        'var a = 100 * p * p;',
        '[a, a, a]'
    ].join("\n");

    function textAnimators(layer) {
        return layer.property("ADBE Text Properties").property("ADBE Text Animators");
    }

    function addAnimator(layer, name, specs, amountExpr) {
        var a = textAnimators(layer).addProperty("ADBE Text Animator");
        a.name = name;
        var idx = a.propertyIndex, i;
        for (i = 0; i < specs.length; i++) {
            textAnimators(layer).property(idx).property("ADBE Text Animator Properties").addProperty(specs[i][0]);
        }
        for (i = 0; i < specs.length; i++) {
            try { textAnimators(layer).property(idx).property("ADBE Text Animator Properties").property(specs[i][0]).setValue(specs[i][1]); } catch (e) {}
        }
        textAnimators(layer).property(idx).property("ADBE Text Selectors").addProperty("ADBE Text Expressible Selector");
        var sel = textAnimators(layer).property(idx).property("ADBE Text Selectors").property(1);
        var amt = null;
        try { amt = sel.property("ADBE Text Expressible Amount"); } catch (e2) {}
        if (!amt) {
            for (i = 1; i <= sel.numProperties; i++) if (/Amount/i.test(sel.property(i).matchName)) { amt = sel.property(i); break; }
        }
        if (amt) amt.expression = amountExpr;
    }

    function setTextDoc(L, str, fontList, size, color, justify, leading) {
        var tp = L.property("ADBE Text Properties").property("ADBE Text Document");
        var td = tp.value;
        try { td.resetCharStyle(); } catch (e) {}
        td.text = str;
        td.fontSize = size;
        td.applyFill = true;
        td.fillColor = color;
        td.applyStroke = false;
        td.tracking = 20;
        td.justification = justify;
        try { td.font = mvPickFont(fontList); } catch (e2) {}
        if (leading) { try { td.autoLeading = false; td.leading = leading; } catch (e3) {} }
        tp.setValue(td);
    }

    // =====================================================================
    // 1つのフォーマット（16:9 / 9:16 / 1:1）を組む
    // =====================================================================
    function buildFormat(proj, folder, fmt, items, o, media, reduced) {
        var W = fmt.w, H = fmt.h, cx = W / 2, cy = H / 2;
        var unit = Math.min(W, H);
        var lastEnd = items[items.length - 1].end;
        var dur = Math.max(lastEnd + 3, media.duration || 0);
        var rng = new MvRng(o.seed);
        var compName = o.compName + "_" + fmt.tag + (reduced ? "_ReducedMotion" : "");
        var comp = proj.items.addComp(compName, W, H, 1, dur, o.fps);
        comp.bgColor = T.color.ground;
        var narrow = W < H * 1.2; // 9:16 と 1:1 は中央揃え・カラム2〜11

        // --- コントロール（エクスプレッションが参照するので最初に） ---
        var ctrl = comp.layers.addNull(dur);
        ctrl.name = CTRL;
        ctrl.label = 2;
        addSlider(ctrl, "IN Duration", reduced ? 0.25 : T.motion.textIn);
        addSlider(ctrl, "IN Stagger", reduced ? 0 : T.motion.stagger);
        addSlider(ctrl, "OUT Duration", T.motion.textOut);

        // --- 音（1つのタイムラインに合わせてダッキング） ---
        var vocalLayer = null;
        if (media.master) {
            var am = comp.layers.add(media.master);
            am.name = "AUDIO_MASTER";
            am.startTime = media.start;
            if (am.hasVideo) am.enabled = false;
        }
        if (media.vocal && media.inst) {
            vocalLayer = comp.layers.add(media.vocal);
            vocalLayer.name = "AUDIO_VOCAL";
            var inst = comp.layers.add(media.inst);
            inst.name = "AUDIO_INST";
            // 歌っている区間（近い行はまとめる）だけ、オケを下げて声の下に敷く
            var lv = inst.property("ADBE Audio Group").property("ADBE Audio Levels");
            var ramp = 0.3, duck = o.duckDb, segs = [];
            for (var a = 0; a < items.length; a++) {
                if (segs.length && items[a].start - segs[segs.length - 1][1] < ramp * 2) segs[segs.length - 1][1] = items[a].end;
                else segs.push([items[a].start, items[a].end]);
            }
            lv.setValueAtTime(0, [0, 0]);
            for (a = 0; a < segs.length; a++) {
                lv.setValueAtTime(Math.max(0.001, segs[a][0] - ramp), [0, 0]);
                lv.setValueAtTime(segs[a][0], [duck, duck]);
                lv.setValueAtTime(segs[a][1], [duck, duck]);
                lv.setValueAtTime(segs[a][1] + ramp, [0, 0]);
            }
        }

        // --- 地（温かい中間色の単色。グラデーションにしない） ---
        var ground = comp.layers.addSolid(T.color.ground, "BG_GROUND", W, H, 1, dur);
        ground.locked = true;

        // --- 構図の計算（Question = 冒頭の絵 → 各行 → Payoff = 冒頭の絵に戻る） ---
        var spacing = o.spacing * W / 1920;
        var raw = computeStops(items.length, o.cameraStyle, spacing, rng, W);
        var opening = { p: [0, 0, 0], r: [0, 0, 0] };
        var dist = Math.round(W * 0.95);
        var sizeDisplay = mvScale(T.type.display, unit);
        var sizeCaption = mvScale(T.type.caption, unit);
        var bandH = Math.round(H * T.grid.captionBand * (narrow ? 1.6 : 1.4));

        // --- キーワード（3D・明朝・グリッドに配置） ---
        var colLeft = mvColumnX(2, W);
        var anchorLayers = [];
        for (var i = 0; i < items.length; i++) {
            var it = items[i];
            var sizeMul = it.emph ? T.type.emphasisScale : 1;
            var L = comp.layers.addText(it.anchor.join("\r"));
            it.id = "LYRIC_" + pad(i + 1, 3) + (it.emph ? "_!" : "");
            L.name = it.id;
            setTextDoc(L, it.anchor.join("\r"), T.font.display, Math.round(sizeDisplay * sizeMul),
                it.emph ? T.color.accent : T.color.ink,
                narrow ? ParagraphJustification.CENTER_JUSTIFY : ParagraphJustification.LEFT_JUSTIFY,
                Math.round(sizeDisplay * sizeMul * 1.25));
            L.threeDLayer = true;
            var rr = L.sourceRectAtTime(0, false);
            // 位置の点（=構図の中心）から見て、文字ブロックの左端がカラム2・高さ40%に来るアンカー
            var ax = narrow ? rr.left + rr.width / 2 : -(colLeft - cx);
            var ay = rr.top + rr.height / 2 + (0.5 - 0.4) * H;
            tr(L).property("ADBE Anchor Point").setValue([ax, ay, 0]);
            if (!reduced) {
                addAnimator(L, "IN", [["ADBE Text Position 3D", [0, Math.round(sizeDisplay * 0.25), 0]], ["ADBE Text Opacity", 0]], EXPR_IN);
            } else {
                addAnimator(L, "IN", [["ADBE Text Opacity", 0]], EXPR_IN);
            }
            addAnimator(L, "OUT", [["ADBE Text Opacity", 0]], EXPR_OUT);
            L.motionBlur = o.motionBlur && !reduced;
            anchorLayers.push(L);
        }

        // --- カメラリグ（揺れ・ゆらぎ無し。移動は行と行の間だけ） ---
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
        var opt = cam.property("ADBE Camera Options Group");
        opt.property("ADBE Camera Zoom").setValue(dist);
        if (o.dof && !reduced) {
            opt.property("ADBE Camera Depth of Field").setValue(1);
            opt.property("ADBE Camera Focus Distance").setValue(dist);
            opt.property("ADBE Camera Aperture").setValue(30);
        }

        var times = [], P = [], RY = [], kinds = [], scenes = [];
        function key(t, p, ry, kind) {
            var fr = 1 / o.fps;
            if (times.length && t <= times[times.length - 1] + fr) t = times[times.length - 1] + fr;
            times.push(t); P.push([cx + p[0], cy + p[1], p[2]]); RY.push(ry); kinds.push(kind);
            return t;
        }
        var stops = [opening];
        for (i = 0; i < raw.length; i++) stops.push(raw[i]);
        // 冒頭の絵で止まり、1行目の直前に移動
        key(0, opening.p, 0, "arrive");
        for (i = 0; i < items.length; i++) {
            var startT = items[i].start;
            var nextT = i + 1 < items.length ? items[i + 1].start : items[i].end;
            var lineDur = nextT - startT;
            var move = Math.min(T.motion.cameraMove, Math.max(0.2, lineDur * 0.3));
            var outD = Math.min(T.motion.textOut, Math.max(0.1, lineDur * 0.15));
            // 到着キー = 行の開始。直前の移動はこの行の開始までに終わる
            var prevStop = stops[i];
            var departPrev = Math.max(times[times.length - 1] + 1 / o.fps, startT - Math.min(T.motion.cameraMove, Math.max(0.2, (startT - (i > 0 ? items[i - 1].start : 0)) * 0.3)));
            key(departPrev, prevStop.p, prevStop.r[1], "depart");
            var arriveT = key(startT, stops[i + 1].p, stops[i + 1].r[1], "arrive");
            // キーワードは「到着して止まってから」出て、「次の移動の前に」消える
            var L2 = anchorLayers[i];
            var cur = stops[i + 1];
            tr(L2).property("ADBE Position").setValue([cx + cur.p[0], cy + cur.p[1], cur.p[2]]);
            tr(L2).property("ADBE Rotate Y").setValue(cur.r[1]);
            var inT = arriveT;
            var outT = (i + 1 < items.length ? nextT - move : items[i].end);
            L2.inPoint = Math.max(0, inT);
            L2.outPoint = Math.max(inT + 0.2, outT);
            scenes.push({
                id: items[i].id, start: startT, end: nextT, anchor: items[i].anchor, caption: items[i].caption,
                emph: items[i].emph, auto: items[i].anchorAuto, tooLong: items[i].anchorTooLong,
                enter: inT, settle: inT + T.motion.textIn, exit: outT - outD, out: outT, move: move
            });
        }
        // Payoff: 最後の行のあと、冒頭の絵に戻って止まる
        var last = stops[stops.length - 1];
        var tEnd = items[items.length - 1].end;
        key(tEnd, last.p, last.r[1], "depart");
        key(Math.min(dur - 0.5, tEnd + T.motion.cameraMove * 1.5), opening.p, 0, "arrive");

        var rigPos = tr(rig).property("ADBE Position");
        rigPos.setValuesAtTimes(times, P);
        applySettle(rigPos, kinds, true, reduced);
        var rigRY = tr(rig).property("ADBE Rotate Y");
        rigRY.setValuesAtTimes(times, RY);
        applySettle(rigRY, kinds, false, reduced);

        // --- 立ち絵（本物の素材。カメラに固定し、止めておく） ---
        if (media.tachie) {
            var tc = comp.layers.add(media.tachie, dur);
            tc.name = "TACHIE";
            tc.threeDLayer = true;
            tc.parent = cam;
            var zBack = 400, kz = (dist + zBack) / dist;
            var side = o.tachieSide === "left" ? -1 : 1;
            var tsc = (H * o.tachieHeight / Math.max(1, media.tachie.height)) * 100 * kz;
            tr(tc).property("ADBE Anchor Point").setValue([media.tachie.width / 2, media.tachie.height, 0]);
            tr(tc).property("ADBE Orientation").setValue([0, 0, 0]);
            tr(tc).property("ADBE Position").setValue([narrow ? 0 : side * W * 0.3 * kz, (H / 2 - bandH) * kz, dist + zBack]);
            tr(tc).property("ADBE Scale").setValue([tsc, tsc, 100]);
        }

        // --- 字幕（2D・焼き込み。下端の帯に、ゴシック・muted） ---
        var band = comp.layers.addSolid(T.color.ground, "CAPTION_BAND", W, bandH, 1, dur);
        tr(band).property("ADBE Position").setValue([cx, H - bandH / 2]);
        tr(band).property("ADBE Opacity").setValue(88);
        var capChars = Math.max(8, Math.floor(W * (1 - 2 * T.grid.margin) / (sizeCaption * 1.05)));
        for (i = 0; i < items.length; i++) {
            var capLines = [];
            var parts = items[i].caption.split(/[\/／]/);
            for (var q = 0; q < parts.length; q++) {
                var w2 = wrap(parts[q], capChars, T.type.maxLines);
                for (var q2 = 0; q2 < w2.length; q2++) capLines.push(w2[q2]);
            }
            if (capLines.length > T.type.maxLines) capLines = [capLines.slice(0, capLines.length - 1).join(" "), capLines[capLines.length - 1]];
            var C = comp.layers.addText(capLines.join("\r"));
            C.name = "CAPTION_" + pad(i + 1, 3);
            setTextDoc(C, capLines.join("\r"), T.font.text, sizeCaption, T.color.muted, ParagraphJustification.CENTER_JUSTIFY, Math.round(sizeCaption * 1.3));
            var cr = C.sourceRectAtTime(0, false);
            tr(C).property("ADBE Anchor Point").setValue([cr.left + cr.width / 2, cr.top + cr.height / 2]);
            tr(C).property("ADBE Position").setValue([cx, H - bandH / 2]);
            C.inPoint = items[i].start;
            C.outPoint = i + 1 < items.length ? Math.min(items[i].end, items[i + 1].start) : items[i].end;
            scenes[i].captionLines = capLines;
        }

        ctrl.moveToBeginning();
        comp.motionBlur = o.motionBlur && !reduced;
        comp.resolutionFactor = [2, 2];
        comp.parentFolder = folder;
        return { comp: comp, scenes: scenes };
    }

    // =====================================================================
    // 書き出し: captions.srt / TIMELINE.md
    // =====================================================================
    function makeSRT(items) {
        var out = [];
        for (var i = 0; i < items.length; i++) {
            var end = i + 1 < items.length ? Math.min(items[i].end, items[i + 1].start) : items[i].end;
            out.push(String(i + 1));
            out.push(srtTime(items[i].start) + " --> " + srtTime(end));
            var parts = items[i].caption.split(/[\/／]/);
            for (var p = 0; p < parts.length; p++) parts[p] = trim(parts[p]);
            out.push(parts.join("\n"));
            out.push("");
        }
        return out.join("\n");
    }

    function makeTimeline(scenes, o, title, artist, checks) {
        var L = [];
        L.push("# TIMELINE（scene_spec）");
        L.push("");
        L.push("曲: " + (title || "（未設定）") + " / " + (artist || "（未設定）") + "　生成: " + SCRIPT_NAME + " v" + VERSION);
        L.push("");
        L.push("| ID | 時間 | 教えること（画面の言葉） | 画面 | 動き（登場 / 落ち着き / 退場） | 字幕 | 音 | 確認: 見た人が言えること |");
        L.push("|---|---|---|---|---|---|---|---|");
        L.push("| OPEN | 0.00s–" + fmtTime(scenes.length ? scenes[0].start : 0) + " | （Question）冒頭の絵 | 冒頭の構図で静止 | カメラ静止 → 1行目へ移動 | — | 前奏 | 「何か置かれている」 |");
        for (var i = 0; i < scenes.length; i++) {
            var s = scenes[i];
            L.push("| " + s.id + " | " + fmtTime(s.start) + "–" + fmtTime(s.end) + " | " + s.anchor.join(" / ") +
                (s.auto ? "（自動）" : "") + (s.emph ? " **強調**" : "") + " | キーワード" + (s.emph ? "（accent）" : "（ink）") +
                "＋字幕。カメラ静止 | " + fmtTime(s.enter) + " / " + fmtTime(s.settle) + " / " + fmtTime(s.exit) + "→" + fmtTime(s.out) +
                "、移動 " + s.move.toFixed(2) + "s | " + (s.captionLines ? s.captionLines.join(" / ") : s.caption) +
                " | " + (o.ducking ? "オケ " + o.duckDb + "dB" : "マスター") + " | 「" + s.anchor.join("") + "」 |");
        }
        L.push("| PAYOFF | " + fmtTime(scenes.length ? scenes[scenes.length - 1].end : 0) + "– | （Payoff）冒頭の絵に戻る | 冒頭と同じ構図 | 移動 → 静止 | — | 後奏 | 「最初の絵の意味がわかった」 |");
        L.push("");
        L.push("## 自動チェック");
        for (var c = 0; c < checks.length; c++) L.push("- " + checks[c]);
        L.push("");
        return L.join("\n");
    }

    // =====================================================================
    // 組み立て本体
    // =====================================================================
    function importItem(proj, path, folder) {
        if (!path) return null;
        var it = proj.importFile(new ImportOptions(new File(path)));
        it.parentFolder = folder;
        return it;
    }

    function buildInner(o, proj) {
        var entries, title = "", artist = "", media = { start: 0 };
        if (o.mode === "lrc") {
            var lrc = parseLRC(readTextFile(o.lyricsPath));
            entries = lrc.entries;
            title = lrc.title;
            artist = lrc.artist;
        } else {
            entries = entriesFromMarkers(o.markerLayer, o.lyricsPath);
            if (o.markerLayer.source && o.markerLayer.hasAudio) {
                media.master = o.markerLayer.source;
                media.start = o.markerLayer.startTime;
            }
        }
        var items = buildItems(entries, o);
        if (!items.length) throw new Error("表示できる歌詞が見つかりませんでした。ファイルの形式を確認してください。");

        var folder = proj.items.addFolder(o.compName + "_parts");
        if (!media.master) media.master = importItem(proj, o.audioPath, folder);
        media.vocal = importItem(proj, o.vocalPath, folder);
        media.inst = importItem(proj, o.instPath, folder);
        if (media.vocal && media.inst) media.master = null; // 別トラックがあるならそちらを使う
        o.ducking = !!(media.vocal && media.inst);
        media.tachie = importItem(proj, o.tachiePath, folder);
        var src = media.master || media.vocal;
        media.duration = src ? media.start + src.duration : 0;

        // --- 自動チェック（verification の一部をビルド時に） ---
        var checks = [];
        var crInk = mvContrast(T.color.ink, T.color.ground), crAcc = mvContrast(T.color.accent, T.color.ground), crMut = mvContrast(T.color.muted, T.color.ground);
        checks.push("コントラスト: キーワード " + crInk.toFixed(2) + ":1 / 強調 " + crAcc.toFixed(2) + ":1 / 字幕 " + crMut.toFixed(2) + ":1（基準 " + T.a11y.minContrast + ":1）" +
            (Math.min(crInk, crAcc, crMut) >= T.a11y.minContrast ? " OK" : " **NG**"));
        var longOnes = [];
        for (var i = 0; i < items.length; i++) if (items[i].anchorTooLong) longOnes.push(pad(i + 1, 3));
        checks.push("キーワードは最大 " + T.type.maxLines + " 行・1行 " + T.type.maxChars + " 文字: " + (longOnes.length ? "**長すぎる行 " + longOnes.join(", ") + "（{}でキーワードを指定してください）**" : "OK"));
        checks.push("点滅: このスクリプトは点滅を作らない（0回/秒）");

        // --- フォーマットごとに組む ---
        var formats = [{ tag: "16x9", w: o.width, h: Math.round(o.width * 9 / 16) }];
        if (o.vertical) formats.push({ tag: "9x16", w: Math.round(o.width * 9 / 16), h: o.width });
        if (o.square) formats.push({ tag: "1x1", w: Math.round(o.width * 9 / 16), h: Math.round(o.width * 9 / 16) });
        var built = [], master = null;
        for (var f = 0; f < formats.length; f++) {
            var r = buildFormat(proj, folder, formats[f], items, o, media, false);
            if (!master) master = r;
            built.push(r.comp.name);
            if (o.reducedMotion) built.push(buildFormat(proj, folder, formats[f], items, o, media, true).comp.name);
        }
        master.comp.parentFolder = proj.rootFolder;
        master.comp.openInViewer();

        // --- 書き出し（LRC の隣、無ければデスクトップ） ---
        var outFolder = o.lyricsPath ? new File(o.lyricsPath).parent : Folder.desktop;
        var base = o.compName;
        var written = [];
        try {
            written.push(writeTextFile(new File(outFolder.fsName + "/" + base + "_captions.srt"), makeSRT(items)));
            written.push(writeTextFile(new File(outFolder.fsName + "/" + base + "_TIMELINE.md"), makeTimeline(master.scenes, o, title, artist, checks)));
        } catch (e) {
            checks.push("書き出しできませんでした: " + e.message);
        }
        return { lines: items.length, comps: built, files: written, checks: checks };
    }

    // =====================================================================
    // 設定の保存 / 読み込み
    // =====================================================================
    var DEFAULTS = {
        mode: "lrc", lyricsPath: "", audioPath: "", vocalPath: "", instPath: "", duckDb: "-3",
        tachiePath: "", tachieSide: "right", tachieHeight: "0.9",
        compName: "MV", width: "1920", fps: "30",
        cameraStyle: "zigzag", spacing: "2400", seed: "7",
        vertical: "1", square: "1", reducedMotion: "1", dof: "0", motionBlur: "1"
    };

    function loadSettings() {
        var s = {};
        for (var k in DEFAULTS) {
            s[k] = DEFAULTS[k];
            try { if (app.settings.haveSetting(SETTINGS_SECTION, k)) s[k] = app.settings.getSetting(SETTINGS_SECTION, k); } catch (e) {}
        }
        return s;
    }

    function saveSettings(s) {
        for (var k in s) { try { app.settings.saveSetting(SETTINGS_SECTION, k, String(s[k])); } catch (e) {} }
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
            b.onClick = function () { var f = File.openDialog(prompt); if (f) et.text = f.fsName; };
        }
        function check(parent, label, v) {
            var cb = parent.add("checkbox", undefined, label);
            cb.value = v === "1";
            return cb;
        }

        var p1 = win.add("panel", undefined, "① タイムライン（歌詞）");
        p1.alignChildren = ["left", "top"];
        var rbLrc = p1.add("radiobutton", undefined, "LRCファイル  [mm:ss.xx]歌詞  {キーワード}  !強調行");
        var rbMk = p1.add("radiobutton", undefined, "選択中レイヤーのマーカー（＋歌詞.txt）");
        rbLrc.value = S.mode !== "markers";
        rbMk.value = !rbLrc.value;
        var g = row(p1);
        var etLyr = field(g, "歌詞ファイル:", S.lyricsPath, 34);
        browse(g, etLyr, "歌詞ファイル (.lrc / .txt)");

        var p2 = win.add("panel", undefined, "② 音（マスター、またはボーカル＋オケ）");
        p2.alignChildren = ["left", "top"];
        g = row(p2);
        var etAud = field(g, "マスター:", S.audioPath, 34);
        browse(g, etAud, "マスター音源");
        g = row(p2);
        var etVoc = field(g, "ボーカル:", S.vocalPath, 34);
        browse(g, etVoc, "ボーカル音源");
        g = row(p2);
        var etInst = field(g, "オケ:", S.instPath, 30);
        browse(g, etInst, "オケ音源");
        var etDuck = field(g, "歌唱中のオケ(dB):", S.duckDb, 3);

        var p3 = win.add("panel", undefined, "③ 素材（本物の立ち絵を使う）");
        p3.alignChildren = ["left", "top"];
        g = row(p3);
        var etTachie = field(g, "立ち絵:", S.tachiePath, 34);
        browse(g, etTachie, "立ち絵画像 (PNG/PSD)");
        g = row(p3);
        g.add("statictext", undefined, "位置:");
        var ddSide = g.add("dropdownlist", undefined, ["右", "左"]);
        ddSide.selection = S.tachieSide === "left" ? 1 : 0;
        var etTH = field(g, "高さ(画面比):", S.tachieHeight, 4);

        var p4 = win.add("panel", undefined, "④ 出力");
        p4.alignChildren = ["left", "top"];
        g = row(p4);
        var etName = field(g, "名前:", S.compName, 12);
        var etW = field(g, "16:9 の幅:", S.width, 5);
        g.add("statictext", undefined, "fps:");
        var fpsList = ["23.976", "24", "25", "29.97", "30", "59.94", "60"];
        var ddFps = g.add("dropdownlist", undefined, fpsList);
        ddFps.selection = 4;
        for (var i = 0; i < fpsList.length; i++) if (fpsList[i] === S.fps) ddFps.selection = i;
        g = row(p4);
        var cbV = check(g, "9:16 も作る", S.vertical);
        var cbS = check(g, "1:1 も作る", S.square);
        var cbR = check(g, "動きを抑えた版も作る", S.reducedMotion);

        var p5 = win.add("panel", undefined, "⑤ カメラ");
        p5.alignChildren = ["left", "top"];
        g = row(p5);
        var ddCam = g.add("dropdownlist", undefined, [CAMERA_STYLES[0].label, CAMERA_STYLES[1].label]);
        ddCam.selection = S.cameraStyle === "straight" ? 1 : 0;
        g = row(p5);
        var etSpace = field(g, "行の間隔(px):", S.spacing, 5);
        var etSeed = field(g, "シード:", S.seed, 4);
        var cbDof = check(g, "被写界深度", S.dof);
        var cbMb = check(g, "モーションブラー", S.motionBlur);

        var gb = win.add("group");
        gb.alignment = "right";
        gb.add("button", undefined, "キャンセル", { name: "cancel" });
        gb.add("button", undefined, "生成", { name: "ok" });
        if (win.show() !== 1) return null;

        var s = {
            mode: rbMk.value ? "markers" : "lrc", lyricsPath: trim(etLyr.text),
            audioPath: trim(etAud.text), vocalPath: trim(etVoc.text), instPath: trim(etInst.text), duckDb: etDuck.text,
            tachiePath: trim(etTachie.text), tachieSide: ddSide.selection.index === 1 ? "left" : "right", tachieHeight: etTH.text,
            compName: trim(etName.text) || "MV", width: etW.text, fps: ddFps.selection.text,
            cameraStyle: CAMERA_STYLES[ddCam.selection.index].key, spacing: etSpace.text, seed: etSeed.text,
            vertical: cbV.value ? "1" : "0", square: cbS.value ? "1" : "0", reducedMotion: cbR.value ? "1" : "0",
            dof: cbDof.value ? "1" : "0", motionBlur: cbMb.value ? "1" : "0"
        };
        saveSettings(s);
        return s;
    }

    function toOptions(s) {
        var w = Math.max(320, Math.round(num(s.width, 1920) / 2) * 2);
        return {
            mode: s.mode, lyricsPath: s.lyricsPath, audioPath: s.audioPath, vocalPath: s.vocalPath, instPath: s.instPath,
            duckDb: Math.min(0, num(s.duckDb, -3)),
            tachiePath: s.tachiePath, tachieSide: s.tachieSide, tachieHeight: Math.max(0.1, Math.min(1.5, num(s.tachieHeight, 0.9))),
            compName: s.compName, width: w, fps: num(s.fps, 30),
            cameraStyle: s.cameraStyle, spacing: Math.max(400, num(s.spacing, 2400)), seed: num(s.seed, 7),
            vertical: s.vertical === "1", square: s.square === "1", reducedMotion: s.reducedMotion === "1",
            dof: s.dof === "1", motionBlur: s.motionBlur === "1", lastLineDur: 4
        };
    }

    function main() {
        var s = showDialog();
        if (!s) return;
        var o = toOptions(s);
        if (o.mode === "lrc" && !o.lyricsPath) { alert("LRCファイルを指定してください。", SCRIPT_NAME); return; }
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
            alert("完成: " + res.lines + " 行\n\nコンポ:\n  " + res.comps.join("\n  ") +
                  (res.files.length ? "\n\n書き出し:\n  " + res.files.join("\n  ") : "") +
                  "\n\nチェック:\n  " + res.checks.join("\n  "), SCRIPT_NAME);
        } catch (err) {
            alert("エラー: " + err.toString() + (err.line ? "\n(line " + err.line + ")" : ""), SCRIPT_NAME);
        } finally {
            app.endUndoGroup();
        }
    }

    main();
})();
