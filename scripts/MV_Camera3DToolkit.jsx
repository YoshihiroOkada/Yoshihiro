#targetengine "MVCamera3DToolkit"
/*
 * MV_Camera3DToolkit.jsx  -  歌ってみたMV用 3Dカメラ＆立ち絵ツールパネル (After Effects)
 *
 * 方針は CLAUDE.md（参考プロンプトを例外なしで適用）:
 *   ・カメラは考えと考えの間で構図を変え、文字が読まれている間は止まる → 手ブレ・揺れ・衝撃揺れは無し
 *   ・動きは独自イージングで落ち着く（バウンス無し）。動きは意味（場所・順番・大きさ）のためだけ
 *   ・立ち絵は本物の素材として、奥行きに置くだけ（ふわふわ等の常時の動きは付けない）
 *
 *  [リグ]   1つのコントローラーで操作できる3Dカメラリグ（オービット/チルト/ロール/ドリー/トラック/ズーム）
 *           フライトゥ、ターゲット巡回、ルックアット
 *  [ムーブ] プッシュイン、オービット、ドリーズームなどをワンクリックでキーフレーム化
 *  [ピント] オートフォーカス、DepthFade
 *  [立ち絵] 立ち絵・背景の奥行き配置（パララックス）、カメラ固定、登場アニメ
 *
 * 使い方: Scripts/ScriptUI Panels に MV_Tokens.jsxinc と一緒に入れ、「ウィンドウ」メニューから開く
 */
#include "MV_Tokens.jsxinc"
(function (thisObj) {
    var NAME = "MV Camera 3D Toolkit";
    var VERSION = "2.0.0";
    var CC = "CAM_CONTROL";
    var C_REF = 'var c = thisComp.layer("' + CC + '");';

    // =====================================================================
    // ユーティリティ
    // =====================================================================
    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }


    function rgba(c) { return [c[0], c[1], c[2], 1]; }


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
        var bg = findLayer(comp, "BG_GROUND");
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
        { key: "ramp", label: "スピードランプ（ゆっくり→ビュン→ゆっくり）", out: 100, inn: 100 },
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
    // カメラは揺らさない: 位置はコントローラーの値そのもの（時間の純関数）
    var EXPR_CAM_POS = C_REF + '\n[c.effect("Truck X")(1), c.effect("Pedestal Y")(1), -c.effect("Distance")(1)]';

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

    // ルックアット: Target と「見続けるレイヤー」を Look At Mix(%) で混ぜる
    var EXPR_TARGET = [
        C_REF,
        'var p = c.effect("Target")(1);',
        'var m = clamp(c.effect("Look At Mix")(1) / 100, 0, 1);',
        'if (m > 0) {',
        '  try {',
        '    var L = c.effect("Look At Layer")(1);',
        '    if (L != null && L.index != c.index) p = add(mul(p, 1 - m), mul(L.toWorld(L.anchorPoint), m));',
        '  } catch (err) {}',
        '}',
        'p'
    ].join("\n");

    // DepthFade: カメラに近すぎる/遠すぎるレイヤーを自動でフェード
    var EXPR_DEPTH_FADE = [
        'var nf = 300, fs = 4000, fe = 7000;',
        'try {',
        '  var c = thisComp.layer("' + CC + '");',
        '  nf = c.effect("Fade Near")(1); fs = c.effect("Fade Far Start")(1); fe = c.effect("Fade Far End")(1);',
        '} catch (err) {}',
        'try {',
        '  var d = length(toWorld(anchorPoint), thisComp.activeCamera.toWorld([0, 0, 0]));',
        '  value * linear(d, 0, Math.max(nf, 1), 0, 1) * linear(d, fs, Math.max(fe, fs + 1), 1, 0);',
        '} catch (err2) { value; }'
    ].join("\n");

    function hasFx(layer, name) {
        return !!layer.property("ADBE Effect Parade").property(name);
    }

    // 旧バージョンで作ったリグにも後から機能を足せるように
    function addRigExtras(ctrl) {
        if (!hasFx(ctrl, "Look At Mix")) addSlider(ctrl, "Look At Mix", 0);
        if (!hasFx(ctrl, "Look At Layer")) addFx(ctrl, "ADBE Layer Control", "Look At Layer");
        if (!hasFx(ctrl, "Fade Near")) addSlider(ctrl, "Fade Near", 300);
        if (!hasFx(ctrl, "Fade Far Start")) addSlider(ctrl, "Fade Far Start", 4000);
        if (!hasFx(ctrl, "Fade Far End")) addSlider(ctrl, "Fade Far End", 7000);
        var tg = findLayer(ctrl.containingComp, "CAM_TARGET");
        if (tg) tr(tg).property("ADBE Position").expression = EXPR_TARGET;
    }

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
        addCheckbox(ctrl, "DOF", 0);
        addCheckbox(ctrl, "Auto Focus", 0);
        addFx(ctrl, "ADBE Layer Control", "Focus Layer");
        addSlider(ctrl, "Focus Distance", dist);
        addSlider(ctrl, "Aperture", 40);
        addSlider(ctrl, "Blur Level", 100);
        addRigExtras(ctrl);

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
        tr(target).property("ADBE Position").expression = EXPR_TARGET;
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
        tr(cam).property("ADBE Rotate Z").expression = exprCtrl("Roll");

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

    function flyToLayer(ctrl, L, t0, t1, o) {
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
    }

    // [リグ] 選択レイヤーへ飛ぶ
    function flyTo(comp, o) {
        var ctrl = getCtrl(comp);
        var sel = selectedAV(comp);
        if (!sel.length) throw new Error("飛んでいきたいレイヤーを選択してください。");
        var t1 = comp.time + o.dur;
        flyToLayer(ctrl, sel[0], comp.time, t1, o);
        comp.time = t1;
    }

    // [リグ] ターゲット巡回: 選択した順にレイヤーを 移動→停留 で巡る
    function targetTour(comp, o) {
        var ctrl = getCtrl(comp);
        var sel = comp.selectedLayers, list = [];
        for (var i = 0; i < sel.length; i++) if (sel[i] instanceof AVLayer && sel[i] !== ctrl) list.push(sel[i]);
        if (!list.length) throw new Error("巡りたいレイヤーを、巡る順番にクリックして選択してください。");
        var t = comp.time;
        for (i = 0; i < list.length; i++) {
            flyToLayer(ctrl, list[i], t, t + o.dur, o);
            t += o.dur + o.hold;
        }
        comp.time = t;
        return list.length + " 個のレイヤーを巡るカメラワークを作りました（移動 " + o.dur + " 秒 / 停留 " + o.hold + " 秒）。";
    }

    // [リグ] ルックアット: 選択レイヤーを見続ける（Look At Mix を 0→100 でなめらかに切替）
    function lookAt(comp, o, on) {
        var ctrl = getCtrl(comp);
        addRigExtras(ctrl);
        var t0 = comp.time, t1 = t0 + o.dur;
        var mix = ctrlProp(ctrl, "Look At Mix");
        if (on) {
            var sel = selectedAV(comp), L = null;
            for (var i = 0; i < sel.length; i++) if (sel[i] !== ctrl && sel[i].name.indexOf("CAM_") !== 0) { L = sel[i]; break; }
            if (!L) throw new Error("見続けたいレイヤーを選択してください。");
            setAt(ctrlProp(ctrl, "Look At Layer"), t0, L.index);
            keyMove(mix, t0, t1, mix.valueAtTime(t0, true), 100, o.ease);
        } else {
            keyMove(mix, t0, t1, mix.valueAtTime(t0, true), 0, o.ease);
        }
        comp.time = t1;
    }

    // [ピント] DepthFade を選択レイヤーに
    function depthFade(comp) {
        var ctrl = findLayer(comp, CC);
        if (ctrl) addRigExtras(ctrl);
        var sel = selectedAV(comp), n = 0;
        for (var i = 0; i < sel.length; i++) {
            var L = sel[i];
            if (L === ctrl || !L.threeDLayer) continue;
            tr(L).property("ADBE Opacity").expression = EXPR_DEPTH_FADE;
            n++;
        }
        if (!n) throw new Error("3Dレイヤーを選択してください。");
        return n + " 個のレイヤーに DepthFade を付けました。距離は CAM_CONTROL の Fade Near / Fade Far Start / Fade Far End で調整できます。";
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
    // [ピント]
    // =====================================================================
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
    // [立ち絵] 奥行き配置・登場（常時の動きは付けない）
    // =====================================================================

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
            if (L.parent) L.parent = null;

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
        var pT = tRig.add("panel", undefined, "ターゲット巡回（選んだ順に巡る）");
        pT.alignChildren = ["left", "top"];
        g = row(pT);
        var etHold = field(g, "停留(秒):", "1.5", 4);
        btn(g, "巡回カメラ作成", run("ターゲット巡回", function (comp) {
            var o = opts();
            o.matchAngle = cbAngle.value;
            o.hold = Math.max(0, num(etHold.text, 1.5));
            return targetTour(comp, o);
        }), 130);
        var pL = tRig.add("panel", undefined, "ルックアット（動きながら選択レイヤーを見続ける）");
        pL.alignChildren = ["left", "top"];
        g = row(pL);
        btn(g, "選択レイヤーを見る", run("ルックアット", function (comp) { lookAt(comp, opts(), true); }), 150);
        btn(g, "解除", run("ルックアット解除", function (comp) { lookAt(comp, opts(), false); }), 70);
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

        // --- ピント ---
        var tFx = tabs.add("tab", undefined, "ピント");
        tFx.alignChildren = ["fill", "top"];
        var pF = tFx.add("panel", undefined, "ピント（被写界深度）");
        pF.alignChildren = ["left", "top"];
        g = row(pF);
        var etAp = field(g, "ボケ量(絞り):", "40", 4);
        var cbKey = g.add("checkbox", undefined, "この時間から切替(キー)");
        g = row(pF);
        btn(g, "選択レイヤーにオートフォーカス", run("フォーカス", function (comp) {
            autoFocus(comp, { aperture: num(etAp.text, 40), keyed: cbKey.value });
        }), 230);
        g = row(pF);
        btn(g, "DepthFade（距離でフェード）", run("DepthFade", depthFade), 230);

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
        var cbLock = g.add("checkbox", undefined, "カメラに固定(常に画面内)");
        var cbBill = g.add("checkbox", undefined, "常にカメラを向く");
        g = row(pP);
        btn(g, "選択レイヤーを3D配置", run("立ち絵配置", function (comp) {
            placeTachie(comp, {
                near: num(etNear.text, 0), far: num(etFar.text, 2500),
                lockToCam: cbLock.value, billboard: cbBill.value
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
