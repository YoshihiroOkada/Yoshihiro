#targetengine "MVCamera3DToolkit"
/*
 * MV_Camera3DToolkit.jsx  -  歌ってみたMV用 3Dカメラ＆立ち絵＆3D空間ツールパネル (After Effects)
 *
 *  [リグ]     1つのコントローラーで操作できる3Dカメラリグ（オービット/チルト/ロール/ドリー/トラック/ズーム）
 *             選択レイヤーへのフライトゥ
 *  [ムーブ]   プッシュイン、オービット、ドリーズーム、ウィップなどをワンクリックでキーフレーム化
 *  [揺れ/ピント] 手ブレプリセット、マーカーで発動するインパクト揺れ、オートフォーカス
 *  [立ち絵]   立ち絵・背景を奥行き配置（パララックス）、カメラ固定、ふわふわ呼吸、登場アニメ
 *  [3D空間]   無限グリッド床、グリッドルーム、浮遊パネル、星空、雰囲気ライト
 *
 * 使い方: Scripts/ScriptUI Panels に入れて「ウィンドウ」メニューから開く（ドッキング可）
 *         または ファイル > スクリプト > スクリプトファイルを実行（フローティングで開く）
 */
(function (thisObj) {
    var NAME = "MV Camera 3D Toolkit";
    var VERSION = "1.0.0";
    var CC = "CAM_CONTROL";
    var C_REF = 'var c = thisComp.layer("' + CC + '");';

    // =====================================================================
    // ユーティリティ
    // =====================================================================
    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function hexToRgb(hex, fallback) {
        var h = String(hex).replace(/^[\s#]+|\s+$/g, "");
        if (h.length === 3) h = h.charAt(0) + h.charAt(0) + h.charAt(1) + h.charAt(1) + h.charAt(2) + h.charAt(2);
        if (!/^[0-9a-fA-F]{6}$/.test(h)) return fallback;
        return [parseInt(h.substr(0, 2), 16) / 255, parseInt(h.substr(2, 2), 16) / 255, parseInt(h.substr(4, 2), 16) / 255];
    }

    function rgba(c) { return [c[0], c[1], c[2], 1]; }

    function Rng(seed) {
        var s = Math.abs(Math.floor(seed)) % 4294967296 || 12345;
        this.next = function () {
            s = (s * 1664525 + 1013904223) % 4294967296;
            return s / 4294967296;
        };
    }
    Rng.prototype.range = function (a, b) { return a + (b - a) * this.next(); };

    function tr(layer) { return layer.property("ADBE Transform Group"); }

    function addFx(layer, matchName, name) {
        var fx = layer.property("ADBE Effect Parade").addProperty(matchName);
        if (name) fx.name = name;
        return fx;
    }

    function addSlider(layer, name, v) { var fx = addFx(layer, "ADBE Slider Control", name); fx.property(1).setValue(v); return fx; }
    function addCheckbox(layer, name, v) { var fx = addFx(layer, "ADBE Checkbox Control", name); fx.property(1).setValue(v); return fx; }
    function addPoint3D(layer, name, v) { var fx = addFx(layer, "ADBE Point3D Control", name); fx.property(1).setValue(v); return fx; }

    function setFx(fx, index, value) {
        try { fx.property(index).setValue(value); } catch (e) {}
    }

    function findLayer(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
        return null;
    }

    function ctrlProp(ctrl, name) {
        return ctrl.property("ADBE Effect Parade").property(name).property(1);
    }

    function getCtrl(comp) {
        var c = findLayer(comp, CC);
        if (!c) throw new Error("先に［リグ］タブで「3Dカメラリグ作成」を押してください。");
        return c;
    }

    // キーがあればその時間にキー、無ければ静的に設定
    function setAt(prop, t, v) {
        if (prop.numKeys > 0) prop.setValueAtTime(t, v);
        else prop.setValue(v);
    }

    function selectedAV(comp) {
        var out = [];
        var sel = comp.selectedLayers;
        for (var i = 0; i < sel.length; i++) {
            if (sel[i] instanceof AVLayer) out.push(sel[i]);
        }
        out.sort(function (a, b) { return a.index - b.index; });
        return out;
    }

    // レイヤーのワールド座標を一時エクスプレッションで取得（親子付けされていてもOK）
    function worldPos(ctrlLayer, L, t) {
        var fx = addPoint3D(ctrlLayer, "__tmp_world", [0, 0, 0]);
        var p = fx.property(1);
        p.expression = 'var L = thisComp.layer(' + L.index + ');\nL.toWorld(L.anchorPoint)';
        var v = p.valueAtTime(t, false);
        fx.remove();
        if (v.length < 3) v = [v[0], v[1], 0];
        return v;
    }

    // 背景(2D)より上・調整レイヤーより下に3Dレイヤーを並べる
    function arrangeBehindFx(comp, L) {
        var bg = findLayer(comp, "BG_GRADIENT");
        if (bg && bg !== L) L.moveBefore(bg);
    }

    function activeCamZoom(comp, t) {
        var cam = comp.activeCamera;
        if (!cam) return null;
        return cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").valueAtTime(t, false);
    }

    // 基準点（リグのターゲット or コンポ中央）とカメラ距離
    function sceneBase(comp) {
        var t = comp.time;
        var ctrl = findLayer(comp, CC);
        if (ctrl) {
            return {
                p: ctrlProp(ctrl, "Target").valueAtTime(t, false),
                dist: ctrlProp(ctrl, "Distance").valueAtTime(t, false)
            };
        }
        return { p: [comp.width / 2, comp.height / 2, 0], dist: activeCamZoom(comp, t) || Math.round(comp.width * 0.95) };
    }

    // =====================================================================
    // イージング
    // =====================================================================
    var EASES = [
        { key: "ease", label: "イーズ（なめらか）", out: 75, inn: 75 },
        { key: "expoOut", label: "エクスポ（急発進→ゆっくり止まる）", out: 8, inn: 95 },
        { key: "expoIn", label: "エクスポ（ゆっくり→急停止）", out: 95, inn: 8 },
        { key: "linear", label: "リニア", linear: true }
    ];

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

    function easeSegment(prop, ka, kb, ease) {
        var B = KeyframeInterpolationType.BEZIER, L = KeyframeInterpolationType.LINEAR;
        if (ease.linear) {
            prop.setInterpolationTypeAtKey(ka, prop.keyInInterpolationType(ka), L);
            prop.setInterpolationTypeAtKey(kb, L, prop.keyOutInterpolationType(kb));
            return;
        }
        var n = easeDims(prop);
        prop.setInterpolationTypeAtKey(ka, prop.keyInInterpolationType(ka), B);
        prop.setInterpolationTypeAtKey(kb, B, prop.keyOutInterpolationType(kb));
        prop.setTemporalEaseAtKey(ka, prop.keyInTemporalEase(ka), easeList(n, ease.out));
        prop.setTemporalEaseAtKey(kb, easeList(n, ease.inn), prop.keyOutTemporalEase(kb));
        if (prop.isSpatial) {
            var zero = (prop.value.length > 2) ? [0, 0, 0] : [0, 0];
            var ks = [ka, kb];
            for (var i = 0; i < ks.length; i++) {
                prop.setSpatialAutoBezierAtKey(ks[i], false);
                prop.setSpatialContinuousAtKey(ks[i], false);
                prop.setSpatialTangentsAtKey(ks[i], zero, zero);
            }
        }
    }

    function keyMove(prop, t0, t1, v0, v1, ease) {
        prop.setValueAtTime(t0, v0);
        prop.setValueAtTime(t1, v1);
        easeSegment(prop, prop.nearestKeyIndex(t0), prop.nearestKeyIndex(t1), ease);
    }

    // =====================================================================
    // エクスプレッション
    // =====================================================================
    var IMPACT_FN = [
        'function mvImpact(c) {',
        '  var m = c.marker;',
        '  if (m.numKeys < 1) return 0;',
        '  var n = m.nearestKey(time).index;',
        '  if (m.key(n).time > time) n--;',
        '  if (n < 1) return 0;',
        '  var t = time - m.key(n).time;',
        '  return c.effect("Impact Amount")(1) * Math.exp(-c.effect("Impact Decay")(1) * t);',
        '}'
    ].join("\n");

    var EXPR_CAM_POS = [
        IMPACT_FN, C_REF,
        'var sh = sub(wiggle(c.effect("Shake Freq")(1), c.effect("Shake Pos")(1)), value);',
        'var im = mvImpact(c);',
        'var hit = [noise(time * 24) * im, noise(time * 24 + 50) * im, 0];',
        'add(add([c.effect("Truck X")(1), c.effect("Pedestal Y")(1), -c.effect("Distance")(1)], sh), hit)'
    ].join("\n");

    var EXPR_CAM_RX = C_REF + '\nwiggle(c.effect("Shake Freq")(1), c.effect("Shake Rot")(1) * 0.6)';
    var EXPR_CAM_RY = C_REF + '\nwiggle(c.effect("Shake Freq")(1), c.effect("Shake Rot")(1) * 0.6)';
    var EXPR_CAM_RZ = [
        IMPACT_FN, C_REF,
        'c.effect("Roll")(1) + wiggle(c.effect("Shake Freq")(1), c.effect("Shake Rot")(1)) + noise(time * 20 + 99) * mvImpact(c) * 0.04'
    ].join("\n");

    var EXPR_FOCUS = [
        C_REF,
        'var d = c.effect("Focus Distance")(1);',
        'if (c.effect("Auto Focus")(1) == 1) {',
        '  try {',
        '    var L = c.effect("Focus Layer")(1);',
        '    if (L != null && L.index != c.index) {',
        '      var cp = toWorld([0, 0, 0]);',
        '      var fw = normalize(sub(toWorld([0, 0, 1]), cp));',
        '      d = Math.max(1, dot(sub(L.toWorld(L.anchorPoint), cp), fw));',
        '    }',
        '  } catch (err) {}',
        '}',
        'd'
    ].join("\n");

    function exprCtrl(name) { return C_REF + '\nc.effect("' + name + '")(1)'; }

    var EXPR_FLOAT_POS = [
        'var a = effect("Float Amount")(1), s = effect("Float Speed")(1);',
        'seedRandom(index, true);',
        'var ph = random(6.28);',
        'var y = Math.sin(time * s * 2 * Math.PI + ph) * a;',
        'value.length > 2 ? add(value, [0, y, 0]) : add(value, [0, y])'
    ].join("\n");

    var EXPR_FLOAT_SCALE = [
        'var b = effect("Breath %")(1) / 100, s = effect("Float Speed")(1);',
        'seedRandom(index, true);',
        'var k = 1 + b * Math.sin(time * s * 2 * Math.PI * 1.3 + random(6.28));',
        'value.length > 2 ? [value[0], value[1] * k, value[2]] : [value[0], value[1] * k]'
    ].join("\n");

    var EXPR_FLOAT_ROT = [
        'seedRandom(index, true);',
        'value + Math.sin(time * effect("Float Speed")(1) * Math.PI + random(6.28)) * effect("Sway°")(1)'
    ].join("\n");

    // 無限グリッド床：カメラ直下にスナップして付いてくる（線はワールドに固定されて見える）
    function exprGridFollow(step) {
        return [
            'try {',
            '  var p = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  [Math.round(p[0] / ' + step + ') * ' + step + ', value[1], Math.round(p[2] / ' + step + ') * ' + step + '];',
            '} catch (err) { value; }'
        ].join("\n");
    }

    var EXPR_SKY_FOLLOW = 'try { add(value, thisComp.activeCamera.toWorld([0, 0, 0])); } catch (err) { value; }';
    var EXPR_TWINKLE = 'seedRandom(index, true);\nvalue * (0.6 + 0.4 * Math.sin(time * random(1, 4) + random(6.28)))';

    // =====================================================================
    // [リグ] 3Dカメラリグ
    // =====================================================================
    function createRig(comp) {
        if (findLayer(comp, CC)) throw new Error("このコンポには既に " + CC + " があります。");
        if (comp.activeCamera && !confirm("このコンポには既にカメラがあります。\nリグ用の新しいカメラを一番上に作って、そちらを使いますか？")) return;

        var W = comp.width, H = comp.height, cx = W / 2, cy = H / 2, dur = comp.duration;
        var dist = Math.round(W * 0.95);
        var base = [cx, cy, 0];

        var ctrl = comp.layers.addNull(dur);
        ctrl.name = CC;
        ctrl.label = 2;
        addPoint3D(ctrl, "Target", base);
        addSlider(ctrl, "Orbit", 0);
        addSlider(ctrl, "Tilt", 0);
        addSlider(ctrl, "Roll", 0);
        addSlider(ctrl, "Distance", dist);
        addSlider(ctrl, "Zoom", dist);
        addSlider(ctrl, "Truck X", 0);
        addSlider(ctrl, "Pedestal Y", 0);
        addSlider(ctrl, "Shake Pos", 0);
        addSlider(ctrl, "Shake Rot", 0);
        addSlider(ctrl, "Shake Freq", 1.5);
        addSlider(ctrl, "Impact Amount", 40);
        addSlider(ctrl, "Impact Decay", 7);
        addCheckbox(ctrl, "DOF", 0);
        addCheckbox(ctrl, "Auto Focus", 0);
        addFx(ctrl, "ADBE Layer Control", "Focus Layer");
        addSlider(ctrl, "Focus Distance", dist);
        addSlider(ctrl, "Aperture", 40);
        addSlider(ctrl, "Blur Level", 100);

        function rigNull(name, parent) {
            var n = comp.layers.addNull(dur);
            n.name = name;
            n.threeDLayer = true;
            n.label = 11;
            tr(n).property("ADBE Anchor Point").setValue([0, 0, 0]);
            if (parent) {
                n.parent = parent;
                tr(n).property("ADBE Position").setValue([0, 0, 0]);
                n.shy = true;
            }
            return n;
        }
        var target = rigNull("CAM_TARGET", null);
        tr(target).property("ADBE Position").expression = exprCtrl("Target");
        var orbit = rigNull("CAM_ORBIT", target);
        tr(orbit).property("ADBE Rotate Y").expression = exprCtrl("Orbit");
        var tilt = rigNull("CAM_TILT", orbit);
        tr(tilt).property("ADBE Rotate X").expression = exprCtrl("Tilt");

        var cam = comp.layers.addCamera("CAM_3D", [cx, cy]);
        cam.autoOrient = AutoOrientType.NO_AUTO_ORIENT;
        cam.parent = tilt;
        tr(cam).property("ADBE Position").setValue([0, 0, 0]);
        tr(cam).property("ADBE Orientation").setValue([0, 0, 0]);
        tr(cam).property("ADBE Rotate X").setValue(0);
        tr(cam).property("ADBE Rotate Y").setValue(0);
        tr(cam).property("ADBE Rotate Z").setValue(0);
        tr(cam).property("ADBE Position").expression = EXPR_CAM_POS;
        tr(cam).property("ADBE Rotate X").expression = EXPR_CAM_RX;
        tr(cam).property("ADBE Rotate Y").expression = EXPR_CAM_RY;
        tr(cam).property("ADBE Rotate Z").expression = EXPR_CAM_RZ;

        var opt = cam.property("ADBE Camera Options Group");
        opt.property("ADBE Camera Zoom").expression = exprCtrl("Zoom");
        try { opt.property("ADBE Camera Depth of Field").expression = exprCtrl("DOF"); } catch (e) {}
        opt.property("ADBE Camera Focus Distance").expression = EXPR_FOCUS;
        opt.property("ADBE Camera Aperture").expression = exprCtrl("Aperture");
        opt.property("ADBE Camera Blur Level").expression = exprCtrl("Blur Level");

        ctrl.moveToBeginning();
        comp.hideShyLayers = true;
        selectOnly(comp, ctrl);
    }

    function selectOnly(comp, layer) {
        for (var i = 1; i <= comp.numLayers; i++) comp.layer(i).selected = false;
        layer.selected = true;
    }

    // [リグ] 選択レイヤーへ飛ぶ
    function flyTo(comp, o) {
        var ctrl = getCtrl(comp);
        var sel = selectedAV(comp);
        if (!sel.length) throw new Error("飛んでいきたいレイヤーを選択してください。");
        var L = sel[0];
        var t0 = comp.time, t1 = t0 + o.dur;
        var target = ctrlProp(ctrl, "Target");
        keyMove(target, t0, t1, target.valueAtTime(t0, true), worldPos(ctrl, L, t0), o.ease);
        if (o.matchAngle && L.threeDLayer && !L.parent) {
            var orbit = ctrlProp(ctrl, "Orbit");
            var v0 = orbit.valueAtTime(t0, true);
            var v1 = tr(L).property("ADBE Rotate Y").valueAtTime(t0, false);
            while (v1 - v0 > 180) v1 -= 360;
            while (v1 - v0 < -180) v1 += 360;
            keyMove(orbit, t0, t1, v0, v1, o.ease);
        }
        comp.time = t1;
    }

    // =====================================================================
    // [ムーブ] カメラムーブのプリセット
    // =====================================================================
    var MOVES = [
        { label: "プッシュイン",    keys: [["Distance", "mul", 0.65]] },
        { label: "プルアウト",      keys: [["Distance", "mul", 1.5]] },
        { label: "ドリーズーム",    keys: [["Distance", "mul", 0.5], ["Zoom", "mul", 0.5]] },
        { label: "オービット ←",   keys: [["Orbit", "add", -45]] },
        { label: "オービット →",   keys: [["Orbit", "add", 45]] },
        { label: "ウィップ 180°",  keys: [["Orbit", "add", 180]] },
        { label: "チルト +",        keys: [["Tilt", "add", 20]] },
        { label: "チルト −",        keys: [["Tilt", "add", -20]] },
        { label: "ロール",          keys: [["Roll", "add", 15]] },
        { label: "トラック ←",     keys: [["Truck X", "add", -400]] },
        { label: "トラック →",     keys: [["Truck X", "add", 400]] },
        { label: "ペデスタル ↕",   keys: [["Pedestal Y", "add", -300]] },
        { label: "スパイラルイン",  keys: [["Orbit", "add", 90], ["Distance", "mul", 0.6], ["Roll", "add", 20]] },
        { label: "リビール",        keys: [["Distance", "mul", 1.8], ["Tilt", "add", 12], ["Orbit", "add", -25]] },
        { label: "元に戻す",        reset: true }
    ];

    function applyMove(comp, mv, o) {
        var ctrl = getCtrl(comp);
        var t0 = comp.time, t1 = t0 + o.dur;
        var keys = mv.keys;
        if (mv.reset) {
            var dist = Math.round(comp.width * 0.95);
            keys = [["Orbit", "set", 0], ["Tilt", "set", 0], ["Roll", "set", 0], ["Distance", "set", dist],
                    ["Zoom", "set", dist], ["Truck X", "set", 0], ["Pedestal Y", "set", 0]];
        }
        for (var i = 0; i < keys.length; i++) {
            var p = ctrlProp(ctrl, keys[i][0]);
            var v0 = p.valueAtTime(t0, true);
            var v1;
            if (keys[i][1] === "mul") v1 = v0 * Math.pow(keys[i][2], o.strength);
            else if (keys[i][1] === "add") v1 = v0 + keys[i][2] * o.strength;
            else v1 = keys[i][2];
            keyMove(p, t0, t1, v0, v1, o.ease);
        }
        comp.time = t1; // 次のムーブをすぐ続けられるように再生ヘッドを進める
    }

    // =====================================================================
    // [揺れ/ピント]
    // =====================================================================
    var SHAKES = [
        { label: "なし",           pos: 0,  rot: 0,   freq: 1.5 },
        { label: "手持ち（自然）", pos: 6,  rot: 0.6, freq: 1.2 },
        { label: "歩き",           pos: 14, rot: 1.2, freq: 2.0 },
        { label: "ドローン（浮遊）", pos: 10, rot: 0.3, freq: 0.35 },
        { label: "緊張感（細かく）", pos: 4,  rot: 0.8, freq: 6 },
        { label: "激しい（サビ）", pos: 30, rot: 3,   freq: 5 }
    ];

    function applyShake(comp, sh) {
        var ctrl = getCtrl(comp);
        var t = comp.time;
        setAt(ctrlProp(ctrl, "Shake Pos"), t, sh.pos);
        setAt(ctrlProp(ctrl, "Shake Rot"), t, sh.rot);
        setAt(ctrlProp(ctrl, "Shake Freq"), t, sh.freq);
    }

    function addImpactNow(comp, amount) {
        var ctrl = getCtrl(comp);
        ctrlProp(ctrl, "Impact Amount").setValue(amount);
        ctrl.property("ADBE Marker").setValueAtTime(comp.time, new MarkerValue("impact"));
    }

    function copyMarkersToImpact(comp, amount) {
        var ctrl = getCtrl(comp);
        var sel = comp.selectedLayers;
        if (sel.length !== 1 || sel[0] === ctrl) throw new Error("マーカーを打ったレイヤー（音源など）を1つ選択してください。");
        var src = sel[0].property("ADBE Marker");
        if (src.numKeys === 0) throw new Error("選択レイヤーにマーカーがありません。");
        ctrlProp(ctrl, "Impact Amount").setValue(amount);
        var dst = ctrl.property("ADBE Marker");
        for (var k = 1; k <= src.numKeys; k++) dst.setValueAtTime(src.keyTime(k), new MarkerValue("impact"));
        return src.numKeys;
    }

    function autoFocus(comp, o) {
        var ctrl = getCtrl(comp);
        var sel = selectedAV(comp);
        var L = null;
        for (var i = 0; i < sel.length; i++) if (sel[i] !== ctrl) { L = sel[i]; break; }
        if (!L) throw new Error("ピントを合わせたいレイヤーを選択してください。");
        var t = comp.time;
        ctrlProp(ctrl, "DOF").setValue(1);
        ctrlProp(ctrl, "Auto Focus").setValue(1);
        ctrlProp(ctrl, "Aperture").setValue(o.aperture);
        var fl = ctrlProp(ctrl, "Focus Layer");
        if (o.keyed) fl.setValueAtTime(t, L.index);
        else setAt(fl, t, L.index);
    }

    // =====================================================================
    // [立ち絵] 奥行き配置・ふわふわ・登場
    // =====================================================================
    function setAnchorBottom(L, t) {
        var A = tr(L).property("ADBE Anchor Point");
        var P = tr(L).property("ADBE Position");
        if (A.numKeys > 0 || P.numKeys > 0) return;
        var r = L.sourceRectAtTime(t, false);
        var a0 = A.value, p0 = P.value, s = tr(L).property("ADBE Scale").value;
        var a1x = r.left + r.width / 2, a1y = r.top + r.height;
        var dx = (a1x - a0[0]) * s[0] / 100, dy = (a1y - a0[1]) * s[1] / 100;
        A.setValue(a0.length > 2 ? [a1x, a1y, a0[2]] : [a1x, a1y]);
        P.setValue(p0.length > 2 ? [p0[0] + dx, p0[1] + dy, p0[2]] : [p0[0] + dx, p0[1] + dy]);
    }

    function addFloat(L) {
        var fxp = L.property("ADBE Effect Parade");
        if (fxp.property("Float Amount")) return;
        addSlider(L, "Float Amount", 10);
        addSlider(L, "Float Speed", 0.35);
        addSlider(L, "Breath %", 1.2);
        addSlider(L, "Sway°", 0.6);
        tr(L).property("ADBE Position").expression = EXPR_FLOAT_POS;
        tr(L).property("ADBE Scale").expression = EXPR_FLOAT_SCALE;
        tr(L).property("ADBE Rotate Z").expression = EXPR_FLOAT_ROT;
    }

    // 選択レイヤーを 上=手前 / 下=奥 に並べ、今の見た目の大きさを保ったまま3D化
    function placeTachie(comp, o) {
        var sel = selectedAV(comp);
        if (!sel.length) throw new Error("立ち絵・背景のレイヤーを選択してください（上のレイヤーほど手前に置きます）。");
        var t = comp.time;
        var cx = comp.width / 2, cy = comp.height / 2;
        var cam = comp.activeCamera;
        var base, dist;
        if (o.lockToCam) {
            if (!cam) throw new Error("カメラがありません。先にリグを作るか、カメラのあるコンポで実行してください。");
            dist = activeCamZoom(comp, t);
        } else {
            var sb = sceneBase(comp);
            base = sb.p;
            dist = sb.dist;
        }
        var n = sel.length, skipped = 0;
        for (var i = 0; i < n; i++) {
            var L = sel[i];
            if (tr(L).property("ADBE Position").numKeys > 0) { skipped++; continue; }
            var isBack = n > 1 && i === n - 1;
            var moving = o.float && !isBack;
            if (L.parent) L.parent = null;
            if (moving) setAnchorBottom(L, t);

            var p = tr(L).property("ADBE Position").value;
            var s = tr(L).property("ADBE Scale").value;
            var z = n > 1 ? o.near + (o.far - o.near) * i / (n - 1) : o.near;
            var k = Math.max(0.05, (dist + z) / dist);

            L.threeDLayer = true;
            var pos;
            if (o.lockToCam) {
                L.parent = cam;
                pos = [(p[0] - cx) * k, (p[1] - cy) * k, dist + z];
            } else {
                pos = [base[0] + (p[0] - cx) * k, base[1] + (p[1] - cy) * k, base[2] + z];
            }
            tr(L).property("ADBE Orientation").setValue([0, 0, 0]);
            tr(L).property("ADBE Position").setValue(pos);
            tr(L).property("ADBE Scale").setValue([s[0] * k, s[1] * k, 100]);
            if (o.billboard && !o.lockToCam) L.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
            if (moving) addFloat(L);
            arrangeBehindFx(comp, L);
        }
        if (skipped) alert(skipped + " 個のレイヤーは位置にキーフレームがあるためスキップしました。", NAME);
    }

    var ENTRANCES = [
        { key: "up", label: "下からスッと" },
        { key: "left", label: "左からスライド" },
        { key: "right", label: "右からスライド" },
        { key: "zoom", label: "ズーム＋ブラー" }
    ];

    function entrance(comp, o) {
        var sel = selectedAV(comp);
        if (!sel.length) throw new Error("登場させたいレイヤーを選択してください。");
        var t0 = comp.time, t1 = t0 + o.dur;
        var expo = EASES[1], smooth = EASES[0];
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i];
            var op = tr(L).property("ADBE Opacity");
            keyMove(op, t0, t0 + o.dur * 0.6, 0, op.valueAtTime(t0, true) || 100, smooth);

            var P = tr(L).property("ADBE Position");
            var p = P.valueAtTime(t0, true);
            var d = comp.width * 0.18;
            var off = { up: [0, d * 0.8], left: [-d, 0], right: [d, 0], zoom: [0, 0] }[o.style];
            if (off[0] || off[1]) {
                var from = p.length > 2 ? [p[0] + off[0], p[1] + off[1], p[2]] : [p[0] + off[0], p[1] + off[1]];
                keyMove(P, t0, t1, from, p, expo);
            }
            if (o.style === "zoom") {
                var S = tr(L).property("ADBE Scale");
                var s = S.valueAtTime(t0, true);
                var big = [];
                for (var j = 0; j < s.length; j++) big.push(s[j] * (j < 2 ? 1.25 : 1));
                keyMove(S, t0, t1, big, s, expo);
            }
            var blur = addFx(L, "ADBE Gaussian Blur 2", "Entrance Blur");
            var bi = blur.propertyIndex;
            var bp = L.property("ADBE Effect Parade").property(bi).property(1);
            keyMove(bp, t0, t1, 40, 0, expo);
        }
    }

    // =====================================================================
    // [3D空間] 環境生成
    // =====================================================================
    // 細い長方形＋リピーターで格子を作る（シェイプレイヤー）
    function makeGrid(comp, name, w, h, step, lw, color, scroll) {
        var sl = comp.layers.addShape();
        sl.name = name;
        var root = sl.property("ADBE Root Vectors Group");
        function lines(gname, rw, rh, copies, off, scrollExpr) {
            var gi = root.addProperty("ADBE Vector Group").propertyIndex;
            root.property(gi).name = gname;
            var vg = function () { return root.property(gi).property("ADBE Vectors Group"); };
            vg().addProperty("ADBE Vector Shape - Rect");
            vg().addProperty("ADBE Vector Graphic - Fill");
            vg().addProperty("ADBE Vector Filter - Repeater");
            vg().property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([rw, rh]);
            vg().property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(color));
            var rep = vg().property("ADBE Vector Filter - Repeater");
            rep.property("ADBE Vector Repeater Copies").setValue(copies);
            rep.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue(off);
            var gp = root.property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Position");
            gp.setValue([-off[0] * (copies - 1) / 2, -off[1] * (copies - 1) / 2]);
            if (scrollExpr) gp.expression = scrollExpr;
        }
        var rows = Math.floor(h / step) + 1, cols = Math.floor(w / step) + 1;
        lines("H_LINES", w, lw, rows, [0, step], scroll ? 'add(value, [0, (time * ' + scroll + ') % ' + step + '])' : null);
        lines("V_LINES", lw, h, cols, [step, 0], null);
        sl.threeDLayer = true;
        var glow = addFx(sl, "ADBE Glo2");
        setFx(glow, 2, 40);
        setFx(glow, 3, 25);
        setFx(glow, 4, 1.2);
        return sl;
    }

    function getDotComp(comp) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === "MV_DOT") return it;
        }
        var dot = app.project.items.addComp("MV_DOT", 64, 64, 1, Math.max(comp.duration, 60), comp.frameRate);
        var s = dot.layers.addSolid([1, 1, 1], "dot", 64, 64, 1, dot.duration);
        var k = 0.5523, r = 30, c = 32;
        var sh = new Shape();
        sh.vertices = [[c, c - r], [c + r, c], [c, c + r], [c - r, c]];
        sh.inTangents = [[-k * r, 0], [0, -k * r], [k * r, 0], [0, k * r]];
        sh.outTangents = [[k * r, 0], [0, k * r], [-k * r, 0], [0, -k * r]];
        sh.closed = true;
        var m = s.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(sh);
        m.property("ADBE Mask Feather").setValue([20, 20]);
        return dot;
    }

    var ENVS = [
        { key: "floor", label: "無限グリッド床（カメラに付いてくる）" },
        { key: "room",  label: "グリッドルーム（箱の中）" },
        { key: "panels", label: "浮遊パネル（イラスト額縁用）" },
        { key: "stars", label: "星空スフィア（カメラに付いてくる）" }
    ];

    function buildEnv(comp, o) {
        var sb = sceneBase(comp);
        var b = sb.p;
        var col = hexToRgb(o.color, [0.2, 0.8, 1]);
        var made = [];
        var rng = new Rng(Math.floor(comp.time * 1000) + 3);

        if (o.type === "floor") {
            var step = 300;
            var f = makeGrid(comp, "ENV_GRID_FLOOR", 12000, 12000, step, 4, col, 0);
            tr(f).property("ADBE Rotate X").setValue(90);
            tr(f).property("ADBE Position").setValue([b[0], b[1] + 700, b[2]]);
            tr(f).property("ADBE Position").expression = exprGridFollow(step);
            tr(f).property("ADBE Opacity").setValue(70);
            made.push(f);
        } else if (o.type === "room") {
            var S = 6000, Hr = 3000, st = 300;
            var defs = [
                ["ENV_ROOM_FLOOR", S, S, [b[0], b[1] + Hr / 2, b[2]], [90, 0]],
                ["ENV_ROOM_CEIL", S, S, [b[0], b[1] - Hr / 2, b[2]], [90, 0]],
                ["ENV_ROOM_LEFT", S, Hr, [b[0] - S / 2, b[1], b[2]], [0, 90]],
                ["ENV_ROOM_RIGHT", S, Hr, [b[0] + S / 2, b[1], b[2]], [0, 90]],
                ["ENV_ROOM_BACK", S, Hr, [b[0], b[1], b[2] + S / 2], [0, 0]]
            ];
            for (var i = 0; i < defs.length; i++) {
                var g = makeGrid(comp, defs[i][0], defs[i][1], defs[i][2], st, 4, col, 0);
                tr(g).property("ADBE Position").setValue(defs[i][3]);
                tr(g).property("ADBE Rotate X").setValue(defs[i][4][0]);
                tr(g).property("ADBE Rotate Y").setValue(defs[i][4][1]);
                tr(g).property("ADBE Opacity").setValue(55);
                made.push(g);
            }
        } else if (o.type === "panels") {
            for (i = 0; i < o.count; i++) {
                var pl = comp.layers.addShape();
                pl.name = "ENV_PANEL_" + (i + 1);
                var root = pl.property("ADBE Root Vectors Group");
                var gi = root.addProperty("ADBE Vector Group").propertyIndex;
                var vg = root.property(gi).property("ADBE Vectors Group");
                vg.addProperty("ADBE Vector Shape - Rect");
                root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Stroke");
                root.property(gi).property("ADBE Vectors Group").addProperty("ADBE Vector Graphic - Fill");
                vg = root.property(gi).property("ADBE Vectors Group");
                var pw = Math.round(rng.range(300, 900));
                vg.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([pw, Math.round(pw * rng.range(0.5, 1.4))]);
                vg.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Color").setValue(rgba(col));
                vg.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Width").setValue(4);
                vg.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(col));
                vg.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(8);
                pl.threeDLayer = true;
                tr(pl).property("ADBE Position").setValue([
                    b[0] + rng.range(-2500, 2500), b[1] + rng.range(-1200, 1200), b[2] + rng.range(-400, 4000)]);
                tr(pl).property("ADBE Rotate X").setValue(rng.range(-10, 10));
                tr(pl).property("ADBE Rotate Y").setValue(rng.range(-35, 35));
                tr(pl).property("ADBE Rotate Z").setValue(rng.range(-6, 6));
                addFloat(pl);
                made.push(pl);
            }
        } else if (o.type === "stars") {
            var dot = getDotComp(comp);
            var R = 5000;
            for (i = 0; i < o.count; i++) {
                var sL = comp.layers.add(dot, comp.duration);
                sL.name = "ENV_STAR_" + (i + 1);
                sL.threeDLayer = true;
                sL.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
                var th = rng.range(0, Math.PI * 2), ph = Math.acos(rng.range(-1, 1)), rr = R * rng.range(0.8, 1.2);
                tr(sL).property("ADBE Position").setValue([
                    rr * Math.sin(ph) * Math.cos(th), rr * Math.cos(ph), rr * Math.sin(ph) * Math.sin(th)]);
                tr(sL).property("ADBE Position").expression = EXPR_SKY_FOLLOW;
                var sc = rng.range(30, 140);
                tr(sL).property("ADBE Scale").setValue([sc, sc, sc]);
                tr(sL).property("ADBE Opacity").setValue(rng.range(40, 100));
                tr(sL).property("ADBE Opacity").expression = EXPR_TWINKLE;
                sL.shy = true;
                made.push(sL);
            }
            comp.hideShyLayers = true;
        }
        for (i = 0; i < made.length; i++) {
            made[i].label = 13;
            var bg = findLayer(comp, "BG_GRADIENT");
            if (bg) made[i].moveBefore(bg);
            else made[i].moveToEnd();
        }
        return made.length;
    }

    function addMoodLights(comp, hex) {
        var sb = sceneBase(comp);
        var b = sb.p;
        var col = hexToRgb(hex, [0.2, 0.8, 1]);
        var amb = comp.layers.addLight("LIGHT_AMBIENT", [comp.width / 2, comp.height / 2]);
        amb.lightType = LightType.AMBIENT;
        amb.property("ADBE Light Options Group").property("ADBE Light Intensity").setValue(65);
        var pt = comp.layers.addLight("LIGHT_KEY", [comp.width / 2, comp.height / 2]);
        pt.lightType = LightType.POINT;
        tr(pt).property("ADBE Position").setValue([b[0] - 600, b[1] - 800, b[2] - 700]);
        pt.property("ADBE Light Options Group").property("ADBE Light Intensity").setValue(90);
        pt.property("ADBE Light Options Group").property("ADBE Light Color").setValue(rgba(col));
    }

    // =====================================================================
    // UI（ドッキングパネル）
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
        w.spacing = 6;
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
        function dropdown(parent, list, sel) {
            var items = [];
            for (var i = 0; i < list.length; i++) items.push(list[i].label);
            var dd = parent.add("dropdownlist", undefined, items);
            dd.selection = sel || 0;
            return dd;
        }
        function note(parent, text) {
            var st = parent.add("statictext", undefined, text, { multiline: true });
            st.alignment = ["fill", "top"];
            return st;
        }

        // 共通: 時間・イージング
        var common = w.add("panel", undefined, "共通");
        common.alignChildren = ["left", "top"];
        var gC = row(common);
        var etDur = field(gC, "時間(秒):", "2", 4);
        var etStr = field(gC, "強さ:", "1.0", 4);
        gC = row(common);
        gC.add("statictext", undefined, "イージング:");
        var ddEase = dropdown(gC, EASES, 1);
        function opts() {
            return {
                dur: Math.max(1 / 60, num(etDur.text, 2)),
                strength: num(etStr.text, 1),
                ease: EASES[ddEase.selection.index]
            };
        }

        var tabs = w.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];

        // --- リグ ---
        var tRig = tabs.add("tab", undefined, "リグ");
        tRig.alignChildren = ["fill", "top"];
        var g = row(tRig);
        btn(g, "3Dカメラリグ作成", run("リグ作成", function (comp) { createRig(comp); }), 150);
        btn(g, "コントローラー選択", run("選択", function (comp) { selectOnly(comp, getCtrl(comp)); }), 130);
        g = row(tRig);
        btn(g, "選択レイヤーへフライ", run("フライトゥ", function (comp) {
            var o = opts();
            o.matchAngle = cbAngle.value;
            flyTo(comp, o);
        }), 150);
        var cbAngle = g.add("checkbox", undefined, "向きも合わせる");
        cbAngle.value = true;
        note(tRig, "CAM_CONTROL のエフェクト（Target / Orbit / Tilt / Roll / Distance / Zoom / Truck X / Pedestal Y）にキーを打って自由に動かせます。");

        // --- ムーブ ---
        var tMove = tabs.add("tab", undefined, "ムーブ");
        tMove.alignChildren = ["fill", "top"];
        note(tMove, "再生ヘッドの位置から［共通の時間］でキーを打ち、再生ヘッドを終点へ進めます（続けて押すと連続ムーブ）。");
        var gm = null;
        for (var i = 0; i < MOVES.length; i++) {
            if (i % 3 === 0) gm = row(tMove);
            btn(gm, MOVES[i].label, (function (mv) {
                return run(mv.label, function (comp) { applyMove(comp, mv, opts()); });
            })(MOVES[i]), 104);
        }

        // --- 揺れ・ピント ---
        var tFx = tabs.add("tab", undefined, "揺れ/ピント");
        tFx.alignChildren = ["fill", "top"];
        var pS = tFx.add("panel", undefined, "カメラの揺れ");
        pS.alignChildren = ["left", "top"];
        g = row(pS);
        var ddShake = dropdown(g, SHAKES, 1);
        btn(g, "適用", run("揺れ", function (comp) { applyShake(comp, SHAKES[ddShake.selection.index]); }), 70);
        g = row(pS);
        var etImp = field(g, "インパクト強さ:", "40", 4);
        btn(g, "今の時間に衝撃", run("インパクト", function (comp) { addImpactNow(comp, num(etImp.text, 40)); }), 110);
        g = row(pS);
        btn(g, "選択レイヤーのマーカーを衝撃に", run("インパクト", function (comp) {
            return copyMarkersToImpact(comp, num(etImp.text, 40)) + " 個のマーカーをインパクトにしました。";
        }), 230);
        note(pS, "音源にビートのマーカーを打って↑を押すと、キックに合わせてカメラがドンと揺れます。");

        var pF = tFx.add("panel", undefined, "ピント（被写界深度）");
        pF.alignChildren = ["left", "top"];
        g = row(pF);
        var etAp = field(g, "ボケ量(絞り):", "40", 4);
        var cbKey = g.add("checkbox", undefined, "この時間から切替(キー)");
        g = row(pF);
        btn(g, "選択レイヤーにオートフォーカス", run("フォーカス", function (comp) {
            autoFocus(comp, { aperture: num(etAp.text, 40), keyed: cbKey.value });
        }), 230);

        // --- 立ち絵 ---
        var tChar = tabs.add("tab", undefined, "立ち絵");
        tChar.alignChildren = ["fill", "top"];
        var pP = tChar.add("panel", undefined, "奥行き配置（パララックス）");
        pP.alignChildren = ["left", "top"];
        note(pP, "立ち絵・背景を選択して実行。上のレイヤーほど手前、一番下は一番奥（背景）。今の見た目のサイズのまま3Dになります。");
        g = row(pP);
        var etNear = field(g, "手前(px):", "0", 5);
        var etFar = field(g, "奥(px):", "2500", 5);
        g = row(pP);
        var cbFloat = g.add("checkbox", undefined, "ふわふわ呼吸");
        cbFloat.value = true;
        var cbLock = g.add("checkbox", undefined, "カメラに固定(常に画面内)");
        var cbBill = g.add("checkbox", undefined, "常にカメラを向く");
        g = row(pP);
        btn(g, "選択レイヤーを3D配置", run("立ち絵配置", function (comp) {
            placeTachie(comp, {
                near: num(etNear.text, 0), far: num(etFar.text, 2500),
                float: cbFloat.value, lockToCam: cbLock.value, billboard: cbBill.value
            });
        }), 180);
        note(pP, "歌詞MV（MV_LyricBuilderで作ったコンポ）では「カメラに固定」がおすすめ。");

        var pE = tChar.add("panel", undefined, "登場アニメ");
        pE.alignChildren = ["left", "top"];
        g = row(pE);
        var ddEnt = dropdown(g, ENTRANCES, 0);
        btn(g, "選択レイヤーに付ける", run("登場", function (comp) {
            var o = opts();
            o.style = ENTRANCES[ddEnt.selection.index].key;
            entrance(comp, o);
        }), 150);

        // --- 3D空間 ---
        var tEnv = tabs.add("tab", undefined, "3D空間");
        tEnv.alignChildren = ["fill", "top"];
        g = row(tEnv);
        var ddEnv = dropdown(g, ENVS, 0);
        g = row(tEnv);
        var etCol = field(g, "色:", "#33CCFF", 7);
        var etCount = field(g, "個数(パネル/星):", "14", 4);
        g = row(tEnv);
        btn(g, "3D空間を生成", run("3D空間", function (comp) {
            var type = ENVS[ddEnv.selection.index].key;
            var cnt = Math.max(1, Math.min(600, Math.round(num(etCount.text, type === "stars" ? 200 : 14))));
            buildEnv(comp, { type: type, color: etCol.text, count: cnt });
        }), 130);
        btn(g, "雰囲気ライト追加", run("ライト", function (comp) { addMoodLights(comp, etCol.text); }), 130);
        note(tEnv, "リグがあればターゲット周辺、無ければコンポ中央に作ります。ライトは3Dレイヤー全体の明るさに影響します。");

        tabs.selection = tRig;

        w.onResizing = w.onResize = function () { this.layout.resize(); };
        w.layout.layout(true);
        if (w instanceof Window) {
            w.center();
            w.show();
        }
        return w;
    }

    buildUI(thisObj);
})(this);
