#targetengine "MVMotionTools"
/*
 * MV_MotionTools.jsx  -  歌ってみたMV用 モーション便利ツールパネル (After Effects)
 *
 * aescripts の定番スクリプトの「よく使う機能」をMV制作向けに1パネルへ:
 *   [イージング] Flow / Ease and Wizz 風   … 選択キーフレームにイージング、オーバーシュート/エラスティック/バウンス
 *   [レイヤー]   Motion (Mt. Mograph) 風   … アンカー9点、順番にずらす、親ヌル、中央へ、ループ、揺らす
 *   [ビート]     Beat Assistant 風         … BPMからマーカー、音から自動でビート検出
 *   [FX]         Glitchify / Deep Glow 風  … ビート連動のグリッチ・フラッシュ・ズームパンチ、多層グロー
 *
 * 使い方: Scripts/ScriptUI Panels に入れて「ウィンドウ」メニューから開く（ドッキング可）
 */
(function (thisObj) {
    var NAME = "MV Motion Tools";
    var VERSION = "1.0.0";

    // =====================================================================
    // ユーティリティ
    // =====================================================================
    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function tr(layer) { return layer.property("ADBE Transform Group"); }

    function addFx(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) fx.name = name;
        return fx;
    }

    function addSlider(layer, name, v) {
        var ex = layer.property("ADBE Effect Parade").property(name);
        if (ex) return ex;
        var fx = addFx(layer, "ADBE Slider Control", name);
        fx.property(1).setValue(v);
        return fx;
    }

    // matchName → インデックスの順でエフェクトのパラメータを探す（日本語版AE対策）
    function fxProp(fx, matchName, index) {
        var p = null;
        try { p = fx.property(matchName); } catch (e) {}
        if (!p) { try { p = fx.property(index); } catch (e2) {} }
        return p;
    }

    function setFx(fx, matchName, index, value) {
        try { var p = fxProp(fx, matchName, index); if (p) p.setValue(value); } catch (e) {}
    }

    function exprFx(fx, matchName, index, expr) {
        try { var p = fxProp(fx, matchName, index); if (p) p.expression = expr; } catch (e) {}
    }

    function findLayer(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
        return null;
    }

    function needLayers(comp, msg) {
        var sel = comp.selectedLayers;
        if (!sel.length) throw new Error(msg || "レイヤーを選択してください。");
        return sel;
    }

    // 選択中の「キーフレームのある/選べる」プロパティ
    function selectedProps(comp) {
        var out = [];
        var sp = comp.selectedProperties;
        for (var i = 0; i < sp.length; i++) {
            if (sp[i].propertyType === PropertyType.PROPERTY) out.push(sp[i]);
        }
        return out;
    }

    function easeDims(prop) {
        if (prop.isSpatial) return 1;
        var v = prop.value;
        return (v instanceof Array) ? v.length : 1;
    }

    function easeList(n, inf) {
        var a = [];
        for (var i = 0; i < n; i++) a.push(new KeyframeEase(0, inf));
        return a;
    }

    // =====================================================================
    // [イージング] Flow / Ease and Wizz 風
    // =====================================================================
    var EASES = [
        { label: "イーズ（F9）",               inn: 33, out: 33 },
        { label: "スムーズ",                   inn: 60, out: 60 },
        { label: "エクスポ（強イーズ）",       inn: 88, out: 88 },
        { label: "急発進 → ゆっくり止まる",    inn: 92, out: 8 },
        { label: "ゆっくり → 急停止",          inn: 8,  out: 92 },
        { label: "イーズイン（出発だけ）",     inn: -1, out: 70 },
        { label: "イーズアウト（到着だけ）",   inn: 70, out: -1 },
        { label: "リニア",                     linear: true },
        { label: "ホールド（パッと切替）",     hold: true }
    ];

    function applyEasePreset(comp, ez) {
        var props = selectedProps(comp);
        var count = 0;
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            var keys = p.selectedKeys;
            if (!keys || !keys.length) continue;
            var n = easeDims(p);
            for (var j = 0; j < keys.length; j++) {
                var k = keys[j];
                if (ez.hold) {
                    p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.HOLD, KeyframeInterpolationType.HOLD);
                } else if (ez.linear) {
                    p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.LINEAR, KeyframeInterpolationType.LINEAR);
                } else {
                    p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
                    // -1 = その側はイーズ無し（影響 0.1% ≒ 勢いのまま）
                    p.setTemporalEaseAtKey(k, easeList(n, ez.inn < 0 ? 0.1 : ez.inn), easeList(n, ez.out < 0 ? 0.1 : ez.out));
                }
                count++;
            }
        }
        if (!count) throw new Error("タイムラインでキーフレームを選択してから押してください。");
    }

    // キーフレーム後の余韻をエクスプレッションで（最後に通過したキーの速度を使う）
    var LAST_KEY = [
        'var n = 0;',
        'if (numKeys > 0) { n = nearestKey(time).index; if (key(n).time > time) n--; }'
    ].join("\n");

    function exprOvershoot(amp, freq, decay) {
        return [
            '// オーバーシュート（' + NAME + '）: amp=揺れ幅, freq=回数/秒, decay=収まる速さ',
            'var amp = ' + amp + ', freq = ' + freq + ', decay = ' + decay + ';',
            LAST_KEY,
            'if (n > 0 && time > key(n).time) {',
            '  var t = time - key(n).time;',
            '  var v = velocityAtTime(key(n).time - thisComp.frameDuration / 10);',
            '  add(value, mul(v, amp * Math.sin(freq * t * 2 * Math.PI) / Math.exp(decay * t)));',
            '} else { value; }'
        ].join("\n");
    }

    var EXPR_BOUNCE = [
        '// バウンス（床で跳ね返る）: e=反発, g=重力',
        'var e = 0.6, g = 6000, nMax = 8;',
        LAST_KEY,
        'if (n > 0 && time > key(n).time) {',
        '  var t = time - key(n).time;',
        '  var v = mul(velocityAtTime(key(n).time - 0.001), -e);',
        '  var isArr = v instanceof Array;',
        '  var vl = isArr ? length(v) : Math.abs(v);',
        '  var vu = isArr ? (vl > 0 ? normalize(v) : mul(v, 0)) : (v < 0 ? -1 : 1);',
        '  var tCur = 0, seg = 2 * vl / g, tNext = seg, nb = 1;',
        '  while (tNext < t && nb <= nMax) { vl *= e; seg *= e; tCur = tNext; tNext += seg; nb++; }',
        '  if (nb <= nMax) { var d = t - tCur; add(value, mul(vu, d * (vl - g * d / 2))); } else { value; }',
        '} else { value; }'
    ].join("\n");

    var EXPR_PRESETS = [
        { label: "オーバーシュート（キュッ）",  expr: exprOvershoot(0.05, 2.5, 7) },
        { label: "エラスティック（ビヨーン）", expr: exprOvershoot(0.09, 3.5, 4) },
        { label: "バウンス（ボン、ボン）",     expr: EXPR_BOUNCE },
        { label: "ループ（繰り返し）",         expr: 'loopOut("cycle")' },
        { label: "ループ（往復）",             expr: 'loopOut("pingpong")' },
        { label: "最後の速度で動き続ける",     expr: 'loopOut("continue")' },
        { label: "揺らす（スライダー付き）",   wiggle: true },
        { label: "エクスプレッション削除",     clear: true }
    ];

    function applyExprPreset(comp, pr) {
        var props = selectedProps(comp);
        var count = 0;
        for (var i = 0; i < props.length; i++) {
            var p = props[i];
            if (!p.canSetExpression) continue;
            if (pr.clear) {
                p.expression = "";
            } else if (pr.wiggle) {
                var L = p.propertyGroup(p.propertyDepth);
                var tag = p.name;
                addSlider(L, tag + " Wiggle Freq", 2);
                addSlider(L, tag + " Wiggle Amp", 20);
                p.expression = 'wiggle(effect("' + tag + ' Wiggle Freq")(1), effect("' + tag + ' Wiggle Amp")(1))';
            } else {
                p.expression = pr.expr;
            }
            count++;
        }
        if (!count) throw new Error("タイムラインでプロパティ（位置・スケールなど）を選択してから押してください。");
    }

    // =====================================================================
    // [レイヤー] Motion 風
    // =====================================================================
    // アンカーポイントを 9点(0..1, 0..1) に移動（見た目の位置はそのまま）
    function setAnchor(comp, fx, fy) {
        var sel = needLayers(comp);
        var t = comp.time;
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i];
            if (!(L instanceof AVLayer)) continue;
            var A = tr(L).property("ADBE Anchor Point");
            var P = tr(L).property("ADBE Position");
            if (A.numKeys > 0 || P.numKeys > 0 || P.dimensionsSeparated) continue;
            var r = L.sourceRectAtTime(t, false);
            var a0 = A.value, p0 = P.value, s = tr(L).property("ADBE Scale").value;
            var ax = r.left + r.width * fx, ay = r.top + r.height * fy;
            var dx = (ax - a0[0]) * s[0] / 100, dy = (ay - a0[1]) * s[1] / 100;
            var rot = tr(L).property("ADBE Rotate Z").value * Math.PI / 180;
            var rx = dx * Math.cos(rot) - dy * Math.sin(rot);
            var ry = dx * Math.sin(rot) + dy * Math.cos(rot);
            A.setValue(a0.length > 2 ? [ax, ay, a0[2]] : [ax, ay]);
            P.setValue(p0.length > 2 ? [p0[0] + rx, p0[1] + ry, p0[2]] : [p0[0] + rx, p0[1] + ry]);
        }
    }

    var SEQ_ORDERS = ["選択した順", "上から", "下から", "ランダム"];

    // レイヤーを少しずつ時間をずらして並べる
    function sequenceLayers(comp, o) {
        var sel = needLayers(comp, "ずらしたいレイヤーを2つ以上選択してください。");
        var list = [];
        for (var i = 0; i < sel.length; i++) list.push(sel[i]);
        if (o.order === 1) list.sort(function (a, b) { return a.index - b.index; });
        if (o.order === 2) list.sort(function (a, b) { return b.index - a.index; });
        if (o.order === 3) {
            for (i = list.length - 1; i > 0; i--) {
                var j = Math.floor(Math.random() * (i + 1));
                var tmp = list[i]; list[i] = list[j]; list[j] = tmp;
            }
        }
        var t0 = o.fromPlayhead ? comp.time : list[0].inPoint;
        var step = o.frames * comp.frameDuration;
        for (i = 0; i < list.length; i++) {
            var L = list[i];
            L.startTime += (t0 + i * step) - L.inPoint;
        }
    }

    function parentNull(comp) {
        var sel = needLayers(comp);
        var sum = [0, 0, 0], cnt = 0, is3D = false;
        for (var i = 0; i < sel.length; i++) {
            if (sel[i].parent) continue;
            var p = tr(sel[i]).property("ADBE Position").value;
            sum[0] += p[0]; sum[1] += p[1]; sum[2] += p.length > 2 ? p[2] : 0;
            if (sel[i].threeDLayer) is3D = true;
            cnt++;
        }
        if (!cnt) throw new Error("親の無いレイヤーを選択してください。");
        var nl = comp.layers.addNull(comp.duration);
        nl.name = "PARENT_NULL";
        nl.threeDLayer = is3D;
        tr(nl).property("ADBE Anchor Point").setValue(is3D ? [0, 0, 0] : [0, 0]);
        tr(nl).property("ADBE Position").setValue(is3D ? [sum[0] / cnt, sum[1] / cnt, sum[2] / cnt] : [sum[0] / cnt, sum[1] / cnt]);
        var topIndex = comp.numLayers;
        for (i = 0; i < sel.length; i++) {
            if (!sel[i].parent && sel[i] !== nl) sel[i].parent = nl;
            topIndex = Math.min(topIndex, sel[i].index);
        }
        if (topIndex > 1) nl.moveBefore(comp.layer(topIndex));
    }

    function centerLayers(comp) {
        var sel = needLayers(comp);
        for (var i = 0; i < sel.length; i++) {
            var P = tr(sel[i]).property("ADBE Position");
            if (P.numKeys > 0 || sel[i].parent || P.dimensionsSeparated) continue;
            var p = P.value;
            P.setValue(p.length > 2 ? [comp.width / 2, comp.height / 2, p[2]] : [comp.width / 2, comp.height / 2]);
        }
    }

    // =====================================================================
    // [ビート] Beat Assistant 風
    // =====================================================================
    function bpmMarkers(comp, o) {
        var sel = needLayers(comp, "マーカーを打つレイヤー（音源など）を選択してください。");
        var L = sel[0];
        if (o.bpm <= 0) throw new Error("BPM を入力してください。");
        var interval = 60 / o.bpm * o.every;
        var mk = L.property("ADBE Marker");
        var n = 0;
        for (var t = o.offset; t < comp.duration && n < 5000; t += interval) {
            var beatNo = Math.round((t - o.offset) / (60 / o.bpm));
            var mv = new MarkerValue(beatNo % 4 === 0 ? "BAR " + (beatNo / 4 + 1) : String(beatNo % 4 + 1));
            mk.setValueAtTime(t, mv);
            n++;
        }
        return n + " 個のマーカーを打ちました（" + o.bpm + " BPM）。";
    }

    function findAmplitudeLayer(comp) {
        var names = ["Audio Amplitude", "オーディオ振幅"];
        for (var i = 0; i < names.length; i++) {
            var L = findLayer(comp, names[i]);
            if (L) return L;
        }
        return null;
    }

    function makeAmplitudeLayer(comp, src) {
        var id = 0;
        try { id = app.findMenuCommandId("Convert Audio to Keyframes"); } catch (e) {}
        if (!id) { try { id = app.findMenuCommandId("オーディオをキーフレームに変換"); } catch (e2) {} }
        if (!id) return null;
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        src.selected = true;
        app.executeCommand(id);
        var L = comp.layer(1);
        if (L === src || L.property("ADBE Effect Parade").numProperties < 3) return null;
        return L;
    }

    // 振幅の「周りより急に大きい山」をビートとして拾う
    function detectBeats(comp, o) {
        var sel = comp.selectedLayers;
        if (sel.length !== 1 || !sel[0].hasAudio) throw new Error("音源レイヤーを1つだけ選択してください。");
        var src = sel[0];
        var amp = findAmplitudeLayer(comp) || makeAmplitudeLayer(comp, src);
        if (!amp) throw new Error("音源を右クリック →「キーフレーム補助 → オーディオをキーフレームに変換」を実行してから、もう一度押してください。");

        var p = amp.property("ADBE Effect Parade").property(3).property(1); // 両チャンネル
        var n = p.numKeys;
        if (n < 5) throw new Error("振幅のキーフレームが足りません。");
        var vals = [], times = [], pre = [0];
        for (var k = 1; k <= n; k++) {
            vals.push(p.keyValue(k));
            times.push(p.keyTime(k));
            pre.push(pre[pre.length - 1] + vals[k - 1]);
        }
        var fd = comp.frameDuration;
        var w = Math.max(2, Math.round(o.window / fd));
        var mk = src.property("ADBE Marker");
        if (o.clear) { while (mk.numKeys > 0) mk.removeKey(1); }
        var last = -1e9, count = 0;
        for (var i = 2; i < n - 2; i++) {
            var v = vals[i];
            if (v < o.minLevel) continue;
            if (!(v >= vals[i - 1] && v >= vals[i - 2] && v > vals[i + 1] && v > vals[i + 2])) continue;
            var a = Math.max(0, i - w), b = Math.min(n - 1, i + w);
            var avg = (pre[b + 1] - pre[a]) / (b - a + 1);
            if (v < avg * o.sensitivity) continue;
            if (times[i] - last < o.minGap) continue;
            // 山の立ち上がり（アタック）にマーカーを置く
            var j = i;
            while (j > 0 && vals[j - 1] < vals[j] && i - j < 3) j--;
            mk.setValueAtTime(times[j], new MarkerValue("beat"));
            last = times[i];
            count++;
        }
        // 歌詞MVのビート連動にも自動でつなぐ
        var mvc = findLayer(comp, "MV_CONTROL");
        if (mvc) { try { mvc.property("ADBE Effect Parade").property("Beat Layer").property(1).setValue(amp.index); } catch (e) {} }
        amp.enabled = false;
        return count + " 個のビートを検出して「" + src.name + "」にマーカーを打ちました。\n多すぎ/少なすぎは「感度」「最小間隔」で調整してください。";
    }

    // =====================================================================
    // [FX] Glitchify / Deep Glow 風（マーカーで発動）
    // =====================================================================
    var ENV_FN = [
        'function mvEnv(hold, decay) {',
        '  var m = thisLayer.marker;',
        '  if (m.numKeys < 1) return 0;',
        '  var n = m.nearestKey(time).index;',
        '  if (m.key(n).time > time) n--;',
        '  if (n < 1) return 0;',
        '  var t = time - m.key(n).time;',
        '  return t < hold ? 1 : Math.exp(-decay * (t - hold));',
        '}'
    ].join("\n");

    function beatSourceMarkers(comp) {
        var sel = comp.selectedLayers;
        if (sel.length === 1 && sel[0].property("ADBE Marker").numKeys > 0) return sel[0];
        return null;
    }

    function copyMarkers(src, dst) {
        if (!src) return 0;
        var a = src.property("ADBE Marker"), b = dst.property("ADBE Marker");
        for (var k = 1; k <= a.numKeys; k++) b.setValueAtTime(a.keyTime(k), new MarkerValue(""));
        return a.numKeys;
    }

    function fxLayer(comp, name, adjustment, color) {
        var L = comp.layers.addSolid(color || [1, 1, 1], name, comp.width, comp.height, 1, comp.duration);
        if (adjustment) L.adjustmentLayer = true;
        L.label = 9;
        return L;
    }

    function beatFx(comp, type) {
        var src = beatSourceMarkers(comp);
        var L, fx;
        if (type === "glitch") {
            L = fxLayer(comp, "FX_BEAT_GLITCH", true);
            addSlider(L, "Amount", 40);
            addSlider(L, "Glitch Frames", 3);
            var gate = ENV_FN + '\nvar g = mvEnv(effect("Glitch Frames")(1) * thisComp.frameDuration, 1000);\n';
            fx = addFx(L, "ADBE Geometry2", "Glitch Shift");
            exprFx(fx, "ADBE Geometry2-0002", 2,
                gate + 'seedRandom(Math.floor(time / thisComp.frameDuration), true);\n' +
                'add(value, [random(-1, 1) * effect("Amount")(1) * 2 * g, random(-1, 1) * effect("Amount")(1) * 0.3 * g])');
            fx = addFx(L, "ADBE Wave Warp", "Glitch Slices");
            setFx(fx, "ADBE Wave Warp-0001", 1, 2);   // 矩形波
            setFx(fx, "ADBE Wave Warp-0003", 3, 60);
            setFx(fx, "ADBE Wave Warp-0004", 4, 90);
            setFx(fx, "ADBE Wave Warp-0005", 5, 0);
            exprFx(fx, "ADBE Wave Warp-0002", 2,
                gate + 'seedRandom(Math.floor(time / thisComp.frameDuration) + 7, true);\nrandom(0.3, 1) * effect("Amount")(1) * g');
            exprFx(fx, "ADBE Wave Warp-0003", 3,
                'seedRandom(Math.floor(time / thisComp.frameDuration) + 3, true);\nrandom(20, 160)');
            fx = addFx(L, "ADBE Noise", "Glitch Noise");
            exprFx(fx, "ADBE Noise-0001", 1, gate + 'g * 25');
        } else if (type === "flash") {
            L = fxLayer(comp, "FX_BEAT_FLASH", false, [1, 1, 1]);
            L.blendingMode = BlendingMode.ADD;
            addSlider(L, "Amount", 60);
            addSlider(L, "Decay", 10);
            tr(L).property("ADBE Opacity").expression = ENV_FN + '\nmvEnv(0, effect("Decay")(1)) * effect("Amount")(1)';
        } else if (type === "punch") {
            L = fxLayer(comp, "FX_BEAT_ZOOM", true);
            addSlider(L, "Amount", 8);
            addSlider(L, "Decay", 8);
            fx = addFx(L, "ADBE Geometry2", "Zoom Punch");
            exprFx(fx, "ADBE Geometry2-0004", 4, ENV_FN + '\nvalue * (1 + mvEnv(0, effect("Decay")(1)) * effect("Amount")(1) / 100)');
        } else if (type === "shake") {
            L = fxLayer(comp, "FX_BEAT_SHAKE", true);
            addSlider(L, "Amount", 25);
            addSlider(L, "Decay", 9);
            fx = addFx(L, "ADBE Geometry2", "Shake");
            exprFx(fx, "ADBE Geometry2-0002", 2, ENV_FN +
                '\nvar e = mvEnv(0, effect("Decay")(1)) * effect("Amount")(1);\nadd(value, [noise(time * 40) * e, noise(time * 40 + 99) * e])');
            exprFx(fx, "ADBE Geometry2-0008", 8, ENV_FN + '\nnoise(time * 30 + 5) * mvEnv(0, effect("Decay")(1)) * effect("Amount")(1) * 0.08');
        }
        L.moveToBeginning();
        var n = copyMarkers(src, L);
        return n
            ? "「" + L.name + "」を作成し、" + n + " 個のマーカーで発動するようにしました。"
            : "「" + L.name + "」を作成しました。\nこのレイヤーにマーカー（テンキー *）を打った位置で発動します。\n（マーカー付きの音源を選択してから押すと自動でコピーします）";
    }

    // Deep Glow 風: 半径の違うグローを重ねて、芯は鋭く・周りはふんわり
    function richGlow(comp) {
        var L = fxLayer(comp, "FX_RICH_GLOW", true);
        var layers = [[70, 12, 1.0], [55, 70, 0.7], [40, 280, 0.45]];
        for (var i = 0; i < layers.length; i++) {
            var g = addFx(L, "ADBE Glo2", "Glow " + (i + 1));
            setFx(g, "ADBE Glo2-0002", 2, layers[i][0]);
            setFx(g, "ADBE Glo2-0003", 3, layers[i][1]);
            setFx(g, "ADBE Glo2-0004", 4, layers[i][2]);
        }
        L.moveToBeginning();
    }

    // =====================================================================
    // UI
    // =====================================================================
    function run(label, fn) {
        return function () {
            var comp = app.project.activeItem;
            if (!(comp instanceof CompItem)) { alert("コンポを開いてから操作してください。", NAME); return; }
            app.beginUndoGroup(NAME + ": " + label);
            try {
                var msg = fn(comp);
                if (msg) alert(msg, NAME);
            } catch (err) {
                alert("エラー: " + err.toString() + (err.line ? "\n(line " + err.line + ")" : ""), NAME);
            } finally {
                app.endUndoGroup();
            }
        };
    }

    function buildUI(thisObj) {
        var w = (thisObj instanceof Panel) ? thisObj
            : new Window("palette", NAME + " v" + VERSION, undefined, { resizeable: true });
        w.orientation = "column";
        w.alignChildren = ["fill", "top"];
        w.margins = 8;

        function row(parent) {
            var g = parent.add("group");
            g.orientation = "row";
            g.alignChildren = ["left", "center"];
            g.spacing = 4;
            return g;
        }
        function field(parent, label, value, chars) {
            parent.add("statictext", undefined, label);
            var et = parent.add("edittext", undefined, value);
            et.characters = chars;
            return et;
        }
        function btn(parent, label, onClick, width) {
            var b = parent.add("button", undefined, label);
            b.preferredSize = [width || 110, 26];
            b.onClick = onClick;
            return b;
        }
        function note(parent, text) {
            var st = parent.add("statictext", undefined, text, { multiline: true });
            st.alignment = ["fill", "top"];
        }
        function grid(parent, list, cols, width, make) {
            var g = null;
            for (var i = 0; i < list.length; i++) {
                if (i % cols === 0) g = row(parent);
                btn(g, list[i].label, make(list[i]), width);
            }
        }

        var tabs = w.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];

        // --- イージング ---
        var tE = tabs.add("tab", undefined, "イージング");
        tE.alignChildren = ["fill", "top"];
        var pE1 = tE.add("panel", undefined, "選択したキーフレームに");
        pE1.alignChildren = ["fill", "top"];
        grid(pE1, EASES, 3, 150, function (ez) {
            return run(ez.label, function (comp) { applyEasePreset(comp, ez); });
        });
        var pE2 = tE.add("panel", undefined, "選択したプロパティにエクスプレッション");
        pE2.alignChildren = ["fill", "top"];
        grid(pE2, EXPR_PRESETS, 2, 200, function (pr) {
            return run(pr.label, function (comp) { applyExprPreset(comp, pr); });
        });
        note(pE2, "オーバーシュート/バウンスは、最後のキーフレームを通過した勢いで揺れます（位置・スケール・回転など）。");

        // --- レイヤー ---
        var tL = tabs.add("tab", undefined, "レイヤー");
        tL.alignChildren = ["fill", "top"];
        var pA = tL.add("panel", undefined, "アンカーポイント（見た目はそのまま）");
        var pts = [[0, 0, "↖"], [0.5, 0, "↑"], [1, 0, "↗"], [0, 0.5, "←"], [0.5, 0.5, "●"], [1, 0.5, "→"], [0, 1, "↙"], [0.5, 1, "↓"], [1, 1, "↘"]];
        var ga = null;
        for (var i = 0; i < pts.length; i++) {
            if (i % 3 === 0) ga = row(pA);
            btn(ga, pts[i][2], (function (pt) {
                return run("アンカー", function (comp) { setAnchor(comp, pt[0], pt[1]); });
            })(pts[i]), 40);
        }
        var pS = tL.add("panel", undefined, "順番にずらす（シーケンス）");
        pS.alignChildren = ["left", "top"];
        var g = row(pS);
        var etFr = field(g, "間隔(フレーム):", "2", 4);
        var ddOrd = g.add("dropdownlist", undefined, SEQ_ORDERS);
        ddOrd.selection = 0;
        g = row(pS);
        var cbPH = g.add("checkbox", undefined, "再生ヘッドから開始");
        cbPH.value = true;
        btn(g, "ずらす", run("シーケンス", function (comp) {
            sequenceLayers(comp, { frames: num(etFr.text, 2), order: ddOrd.selection.index, fromPlayhead: cbPH.value });
        }), 90);
        g = row(tL);
        btn(g, "親ヌルを作る", run("親ヌル", parentNull), 120);
        btn(g, "画面中央へ", run("中央へ", centerLayers), 120);

        // --- ビート ---
        var tB = tabs.add("tab", undefined, "ビート");
        tB.alignChildren = ["fill", "top"];
        var pB1 = tB.add("panel", undefined, "BPMからマーカー（選択レイヤーに）");
        pB1.alignChildren = ["left", "top"];
        g = row(pB1);
        var etBpm = field(g, "BPM:", "128", 5);
        var ddEvery = g.add("dropdownlist", undefined, ["毎拍", "2拍ごと", "1小節ごと", "半拍ごと"]);
        ddEvery.selection = 0;
        g = row(pB1);
        note(g, "1拍目 = 再生ヘッド位置");
        btn(g, "マーカーを打つ", run("BPMマーカー", function (comp) {
            var ev = [1, 2, 4, 0.5][ddEvery.selection.index];
            return bpmMarkers(comp, { bpm: num(etBpm.text, 0), every: ev, offset: comp.time });
        }), 120);
        var pB2 = tB.add("panel", undefined, "音から自動検出（音源レイヤーを選択）");
        pB2.alignChildren = ["left", "top"];
        g = row(pB2);
        var etSens = field(g, "感度:", "1.4", 4);
        var etGap = field(g, "最小間隔(秒):", "0.25", 4);
        var etMin = field(g, "最小音量:", "3", 3);
        g = row(pB2);
        var cbClr = g.add("checkbox", undefined, "既存マーカーを消す");
        btn(g, "ビート検出", run("ビート検出", function (comp) {
            return detectBeats(comp, {
                sensitivity: num(etSens.text, 1.4), minGap: num(etGap.text, 0.25),
                minLevel: num(etMin.text, 3), window: 0.5, clear: cbClr.value
            });
        }), 110);
        note(pB2, "感度: 大きいほど強い音だけ拾う。検出後、歌詞MVの MV_CONTROL > Beat Layer にも自動で接続します。");

        // --- FX ---
        var tF = tabs.add("tab", undefined, "FX");
        tF.alignChildren = ["fill", "top"];
        note(tF, "マーカー付きの音源を選択して押すと、そのビートで発動するエフェクトレイヤーを作ります。");
        var FXS = [
            { label: "ビートでグリッチ", type: "glitch" },
            { label: "ビートでフラッシュ", type: "flash" },
            { label: "ビートでズームパンチ", type: "punch" },
            { label: "ビートで画面揺れ", type: "shake" }
        ];
        grid(tF, FXS, 2, 170, function (f) {
            return run(f.label, function (comp) { return beatFx(comp, f.type); });
        });
        g = row(tF);
        btn(g, "リッチグロー（多層）", run("リッチグロー", richGlow), 170);
        note(tF, "強さは各レイヤーの Amount / Decay スライダーで調整。区間だけ効かせたいときはレイヤーをトリミング。");

        tabs.selection = tE;
        w.onResizing = w.onResize = function () { this.layout.resize(); };
        w.layout.layout(true);
        if (w instanceof Window) { w.center(); w.show(); }
        return w;
    }

    buildUI(thisObj);
})(this);
