#targetengine "MVTachieRig"
/*
 * MV_TachieRig.jsx  -  立ち絵にボーンを入れて動かすリグツールパネル (After Effects)
 *
 * PSDをパーツ分け（頭・体・腕・髪など）して読み込んだ立ち絵に:
 *   [ボーン]  選んだ順に親子付けして関節を作る / 髪・リボンの揺れもの（遅れて揺れる物理っぽさ）
 *   [IK]      上腕→前腕(→手) を選ぶと、コントローラーを動かすだけで腕が曲がる2ボーンIK（Duik 風）
 *   [顔]      まばたき自動 / 歌声に合わせた口パク / ジョイスティックで顔の向きを2.5Dで変える（Joysticks 'n Sliders 風）
 *
 * 使い方: Scripts/ScriptUI Panels に入れて「ウィンドウ」メニューから開く（ドッキング可）
 */
(function (thisObj) {
    var NAME = "MV Tachie Rig";
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

    function ensureSlider(layer, name, v) {
        var ex = layer.property("ADBE Effect Parade").property(name);
        if (ex) return ex;
        var fx = addFx(layer, "ADBE Slider Control", name);
        fx.property(1).setValue(v);
        return fx;
    }

    function ensureCheckbox(layer, name, v) {
        var ex = layer.property("ADBE Effect Parade").property(name);
        if (ex) return ex;
        var fx = addFx(layer, "ADBE Checkbox Control", name);
        fx.property(1).setValue(v);
        return fx;
    }

    function findLayer(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
        return null;
    }

    function jsString(s) {
        return '"' + String(s).replace(/\\/g, "\\\\").replace(/"/g, '\\"') + '"';
    }

    // 選択した順（クリックした順）の AVLayer
    function selectionInOrder(comp, min, msg) {
        var sel = comp.selectedLayers, out = [];
        for (var i = 0; i < sel.length; i++) if (sel[i] instanceof AVLayer) out.push(sel[i]);
        if (out.length < min) throw new Error(msg);
        return out;
    }

    function byTimelineOrder(list) {
        var a = list.slice(0);
        a.sort(function (x, y) { return x.index - y.index; });
        return a;
    }

    // 一時エクスプレッションで値を読む（レイヤーのコンポ座標・ワールド回転など）
    function evalOn(L, expr, t) {
        var fx = addFx(L, "ADBE Point Control", "__tmp_eval");
        var p = fx.property(1);
        p.expression = expr;
        var v = p.valueAtTime(t, false);
        L.property("ADBE Effect Parade").property(fx.propertyIndex).remove();
        return v;
    }

    function compPoint(L, pt, t) {
        return evalOn(L, "thisLayer.toComp([" + pt[0] + ", " + pt[1] + "])", t);
    }

    function worldRot(L, t) {
        return evalOn(L, [
            "var l = thisLayer, r = 0;",
            "while (l) { r += l.transform.rotation; l = l.hasParent ? l.parent : null; }",
            "[r, 0]"
        ].join("\n"), t)[0];
    }

    // 見た目を変えずにアンカーポイントを (fx, fy) = 0..1 の位置へ
    function setAnchorRel(L, fx, fy, t) {
        var A = tr(L).property("ADBE Anchor Point"), P = tr(L).property("ADBE Position");
        if (A.numKeys > 0 || P.numKeys > 0 || P.dimensionsSeparated) return;
        var r = L.sourceRectAtTime(t, false);
        var a0 = A.value, p0 = P.value, s = tr(L).property("ADBE Scale").value;
        var ax = r.left + r.width * fx, ay = r.top + r.height * fy;
        var dx = (ax - a0[0]) * s[0] / 100, dy = (ay - a0[1]) * s[1] / 100;
        var rot = tr(L).property("ADBE Rotate Z").value * Math.PI / 180;
        var rx = dx * Math.cos(rot) - dy * Math.sin(rot), ry = dx * Math.sin(rot) + dy * Math.cos(rot);
        A.setValue(a0.length > 2 ? [ax, ay, a0[2]] : [ax, ay]);
        P.setValue(p0.length > 2 ? [p0[0] + rx, p0[1] + ry, p0[2]] : [p0[0] + rx, p0[1] + ry]);
    }

    function setParentKeep(child, parent) {
        if (child !== parent && child.parent !== parent) child.parent = parent;
    }

    // =====================================================================
    // [ボーン] 親子チェーン / 揺れもの
    // =====================================================================
    // 選んだ順に 親→子→孫… とつなぐ（関節 = 各パーツの上端中央 に自動セット可）
    function makeChain(comp, o) {
        var list = selectionInOrder(comp, 2, "つなげたいパーツを「根元 → 先端」の順にクリックして2つ以上選択してください。");
        var t = comp.time;
        for (var i = 0; i < list.length; i++) {
            if (o.autoJoint) setAnchorRel(list[i], 0.5, 0, t);
            if (i > 0) setParentKeep(list[i], list[i - 1]);
        }
        return list.length + " 個のパーツをチェーンにしました。一番上のパーツを回すと全部ついてきます。";
    }

    // 揺れもの: 根元から遠いほど遅れて大きく揺れる + 根元の移動に引っ張られる慣性
    function exprSwing(depth) {
        return [
            '// 揺れもの（' + NAME + '）: 設定は根元パーツの Swing エフェクト',
            'var r = thisLayer;',
            'for (var i = 0; i < ' + depth + '; i++) r = r.parent;',
            'var amp = r.effect("Swing Amp")(1), f = r.effect("Swing Freq")(1);',
            'var lag = r.effect("Swing Lag")(1), k = r.effect("Swing Inertia")(1);',
            'var t = time - ' + depth + ' * lag;',
            'var sway = Math.sin(t * f * 2 * Math.PI) * amp * (0.6 + 0.4 * ' + depth + ');',
            'var dt = 0.04;',
            'var p1 = r.toComp(r.anchorPoint, t), p0 = r.toComp(r.anchorPoint, t - dt);',
            'var vx = (p1[0] - p0[0]) / dt;',
            'value + sway - vx * k'
        ].join("\n");
    }

    function makeSwing(comp, o) {
        var list = selectionInOrder(comp, 2, "髪・リボンなどのパーツを「根元 → 先端」の順にクリックして2つ以上選択してください。\n（1本の髪を数枚に分けておくと、しなるように揺れます）");
        makeChain(comp, o);
        var root = list[0];
        ensureSlider(root, "Swing Amp", o.amp);
        ensureSlider(root, "Swing Freq", o.freq);
        ensureSlider(root, "Swing Lag", 0.12);
        ensureSlider(root, "Swing Inertia", 0.015);
        for (var i = 1; i < list.length; i++) tr(list[i]).property("ADBE Rotate Z").expression = exprSwing(i);
        return "揺れものを作りました。強さは「" + root.name + "」の Swing Amp / Freq / Lag / Inertia で調整できます。";
    }

    // 呼吸: 体パーツを足元基準でゆっくり伸び縮み
    function makeBreath(comp) {
        var list = selectionInOrder(comp, 1, "体のパーツを選択してください。");
        for (var i = 0; i < list.length; i++) {
            var L = list[i];
            setAnchorRel(L, 0.5, 1, comp.time);
            ensureSlider(L, "Breath %", 1.2);
            ensureSlider(L, "Breath Speed", 0.3);
            tr(L).property("ADBE Scale").expression = [
                'var k = 1 + effect("Breath %")(1) / 100 * Math.sin(time * effect("Breath Speed")(1) * 2 * Math.PI);',
                'var w = 1 - (k - 1) * 0.3;',
                'value.length > 2 ? [value[0] * w, value[1] * k, value[2]] : [value[0] * w, value[1] * k]'
            ].join("\n");
        }
    }

    // =====================================================================
    // [IK] 2ボーンIK（上腕 → 前腕 → 手）
    // =====================================================================
    var WORLD_ROT_FN = 'function wr(l) { var r = 0; while (l) { r += l.transform.rotation; l = l.hasParent ? l.parent : null; } return r; }';

    function farEdgePoint(L, t) {
        // アンカーから一番遠い辺の中点を「先端」とみなす
        var r = L.sourceRectAtTime(t, false), a = tr(L).property("ADBE Anchor Point").value;
        var cand = [[r.left + r.width / 2, r.top], [r.left + r.width / 2, r.top + r.height],
                    [r.left, r.top + r.height / 2], [r.left + r.width, r.top + r.height / 2]];
        var best = cand[0], bd = -1;
        for (var i = 0; i < cand.length; i++) {
            var d = Math.pow(cand[i][0] - a[0], 2) + Math.pow(cand[i][1] - a[1], 2);
            if (d > bd) { bd = d; best = cand[i]; }
        }
        return best;
    }

    function makeIK(comp, o) {
        var list = selectionInOrder(comp, 2, "「上腕 → 前腕（→ 手）」の順にクリックして選択してください。\n（脚なら 太もも → すね → 足）");
        var upper = list[0], fore = list[1], hand = list.length > 2 ? list[2] : null;
        var t = comp.time;
        if (o.autoJoint) {
            setAnchorRel(upper, 0.5, 0, t);
            setAnchorRel(fore, 0.5, 0, t);
            if (hand) setAnchorRel(hand, 0.5, 0, t);
        }
        setParentKeep(fore, upper);
        if (hand) setParentKeep(hand, fore);

        var A = compPoint(upper, tr(upper).property("ADBE Anchor Point").value, t);
        var E = compPoint(fore, tr(fore).property("ADBE Anchor Point").value, t);
        // 手があれば手首（手のアンカー）、無ければ前腕の先端がIKの目標
        var T = hand ? compPoint(hand, tr(hand).property("ADBE Anchor Point").value, t)
                     : compPoint(fore, farEdgePoint(fore, t), t);
        var L1 = Math.sqrt(Math.pow(E[0] - A[0], 2) + Math.pow(E[1] - A[1], 2));
        var L2 = Math.sqrt(Math.pow(T[0] - E[0], 2) + Math.pow(T[1] - E[1], 2));
        if (L1 < 1 || L2 < 1) throw new Error("関節の位置が近すぎます。上腕・前腕のアンカーポイント（肩・ひじ）を確認してください。");
        var th1 = Math.atan2(E[1] - A[1], E[0] - A[0]) * 180 / Math.PI;
        var th2 = Math.atan2(T[1] - E[1], T[0] - E[0]) * 180 / Math.PI;
        var W1 = worldRot(upper, t), W2 = worldRot(fore, t), W3 = hand ? worldRot(hand, t) : 0;

        // 曲がる向き: 今のひじの位置が 肩→手 の線のどちら側にあるか
        var cross = (T[0] - A[0]) * (E[1] - A[1]) - (T[1] - A[1]) * (E[0] - A[0]);
        var flip0 = cross < 0 ? 1 : 0;

        var ctrlName = "IK_" + upper.name;
        var c = comp.layers.addNull(comp.duration);
        c.name = ctrlName;
        c.label = 14;
        tr(c).property("ADBE Anchor Point").setValue([50, 50]);
        tr(c).property("ADBE Position").setValue([T[0], T[1]]);
        ensureCheckbox(c, "Flip", flip0);
        ensureSlider(c, "Stretch %", 0);
        if (o.followBody && upper.parent) c.parent = upper.parent;
        c.moveBefore(byTimelineOrder(list)[0]);

        var C = 'var c = thisComp.layer(' + jsString(ctrlName) + ');';
        var common = [
            C, WORLD_ROT_FN,
            'var T = c.toComp(c.anchorPoint);',
            'var L1 = ' + L1 + ', L2 = ' + L2 + ';'
        ].join("\n");

        tr(upper).property("ADBE Rotate Z").expression = [
            '// 2ボーンIK（' + NAME + '）: ' + ctrlName + ' を動かすと腕が曲がる',
            common,
            'var A = hasParent ? parent.toComp(transform.position) : transform.position;',
            'var d = sub(T, A);',
            'var s = 1 + c.effect("Stretch %")(1) / 100 * Math.max(0, length(d) / (L1 + L2) - 1);',
            'L1 *= s; L2 *= s;',
            'var D = clamp(length(d), Math.abs(L1 - L2) + 0.01, L1 + L2 - 0.01);',
            'var a1 = Math.acos(clamp((L1 * L1 + D * D - L2 * L2) / (2 * L1 * D), -1, 1));',
            'var sg = c.effect("Flip")(1) == 1 ? -1 : 1;',
            'var th = radiansToDegrees(Math.atan2(d[1], d[0]) + sg * a1);',
            'th - ' + th1 + ' + ' + W1 + ' - (hasParent ? wr(parent) : 0)'
        ].join("\n");

        tr(fore).property("ADBE Rotate Z").expression = [
            '// 2ボーンIK（' + NAME + '）',
            common,
            'var E = parent.toComp(transform.position);',
            'var th = radiansToDegrees(Math.atan2(T[1] - E[1], T[0] - E[0]));',
            'th - ' + th2 + ' + ' + W2 + ' - wr(parent)'
        ].join("\n");

        if (hand) {
            tr(hand).property("ADBE Rotate Z").expression = [
                '// 手の向きはコントローラーの回転で決まる（腕を曲げても手首の角度は保つ）',
                C, WORLD_ROT_FN,
                W3 + ' + c.transform.rotation - wr(parent)'
            ].join("\n");
        }
        return "IKを作りました。「" + ctrlName + "」を動かすと腕が曲がります。\n曲がる向きが逆なら Flip、伸ばしたいなら Stretch % を上げてください。";
    }

    // =====================================================================
    // [顔] まばたき / 口パク / ジョイスティック
    // =====================================================================
    // どの目も同じタイミングで瞬きするよう、シード固定のスケジュールを歩く
    function blinkFn(interval, dur) {
        return [
            'function blinkF() {',
            '  var iv = ' + interval + ', dur = ' + dur + ', s = 0;',
            '  for (var k = 0; k < 2000; k++) {',
            '    seedRandom(k + 101, true);',
            '    s += iv * random(0.5, 1.5);',
            '    if (s > time) return 0;',
            '    if (time < s + dur) return Math.sin(Math.PI * (time - s) / dur);',
            '    seedRandom(k + 5001, true);',
            '    if (random() < 0.15 && time < s + dur * 2.5 && time >= s + dur * 1.5) return Math.sin(Math.PI * (time - s - dur * 1.5) / dur);',
            '  }',
            '  return 0;',
            '}'
        ].join("\n");
    }

    function makeBlink(comp, o) {
        var sel = selectionInOrder(comp, 1, "目のレイヤーを選択してください。\n・1枚の目 → 縦につぶして瞬き\n・「開いた目」→「閉じた目」の順に2枚 → 切り替えで瞬き");
        var fn = blinkFn(o.interval, o.dur);
        if (sel.length === 2 && o.swap) {
            tr(sel[0]).property("ADBE Opacity").expression = fn + '\nblinkF() > 0.5 ? 0 : value';
            tr(sel[1]).property("ADBE Opacity").expression = fn + '\nblinkF() > 0.5 ? value : 0';
            tr(sel[1]).property("ADBE Opacity").setValue(100);
            return "開いた目／閉じた目の切り替えで瞬きするようにしました。";
        }
        for (var i = 0; i < sel.length; i++) {
            setAnchorRel(sel[i], 0.5, 0.55, comp.time);
            tr(sel[i]).property("ADBE Scale").expression = fn + [
                '',
                'var f = blinkF();',
                'value.length > 2 ? [value[0], value[1] * (1 - 0.9 * f), value[2]] : [value[0], value[1] * (1 - 0.9 * f)]'
            ].join("\n");
        }
        return sel.length + " 枚の目に自動まばたきを付けました。";
    }

    function findAmplitude(comp) {
        var names = ["VOICE_AMP", "Audio Amplitude", "オーディオ振幅"];
        for (var i = 0; i < names.length; i++) {
            var L = findLayer(comp, names[i]);
            if (L && L.property("ADBE Effect Parade").numProperties >= 3) return L;
        }
        return null;
    }

    // 口パク: 歌声の音量で 閉じ / 半開き / 開き を切り替え
    function makeLipSync(comp, o) {
        var sel = selectionInOrder(comp, 1, "口のレイヤーを「閉じた口 →（半開き）→ 開いた口」の順にクリックして選択してください。\n（1枚だけなら縦に伸び縮みさせます）");
        var amp = findAmplitude(comp);
        if (!amp) throw new Error("歌声の音量レイヤーがありません。\n\nボーカル音源を右クリック →「キーフレーム補助 → オーディオをキーフレームに変換」を実行して、できたレイヤーの名前を VOICE_AMP にしてからもう一度押してください。\n（オケ込みの音源より、ボーカルだけの音源の方が正確です）");
        var AMP = [
            'var A = thisComp.layer(' + jsString(amp.name) + ').effect(3)(1);',
            'var v = (A.value + A.valueAtTime(time - thisComp.frameDuration)) / 2;',
            'var lo = ' + o.lo + ', hi = ' + o.hi + ';'
        ].join("\n");
        var n = sel.length;
        if (n === 1) {
            setAnchorRel(sel[0], 0.5, 0.3, comp.time);
            tr(sel[0]).property("ADBE Scale").expression = AMP + [
                '',
                'var k = linear(v, lo * 0.5, hi * 1.3, 0.25, 1.25);',
                'value.length > 2 ? [value[0] * (1.1 - k * 0.1), value[1] * k, value[2]] : [value[0] * (1.1 - k * 0.1), value[1] * k]'
            ].join("\n");
            return "口を歌声に合わせて伸び縮みさせるようにしました（音量レイヤー: " + amp.name + "）。";
        }
        for (var i = 0; i < n; i++) {
            tr(sel[i]).property("ADBE Opacity").setValue(100);
            tr(sel[i]).property("ADBE Opacity").expression = AMP + [
                '',
                'var st = v < lo ? 0 : (' + n + ' > 2 && v < hi ? 1 : ' + (n - 1) + ');',
                'st == ' + i + ' ? value : 0'
            ].join("\n");
        }
        return n + " 枚の口を歌声で切り替えるようにしました（音量レイヤー: " + amp.name + "）。\n開きすぎ/開かなすぎは「開き始め」「大きく開く」の値で調整して再実行してください。";
    }

    // ジョイスティック: コントローラーを動かすと、手前のパーツほど大きく・奥のパーツは逆に動いて顔の向きが変わる
    function makeJoystick(comp, o) {
        var list = byTimelineOrder(selectionInOrder(comp, 2,
            "顔のパーツ（前髪・目・眉・口・鼻・顔の輪郭・後ろ髪など）を2つ以上選択してください。\nタイムラインで上にあるほど「手前」として扱います。"));
        var t = comp.time;
        var sum = [0, 0];
        for (var i = 0; i < list.length; i++) {
            var p = compPoint(list[i], tr(list[i]).property("ADBE Anchor Point").value, t);
            sum[0] += p[0]; sum[1] += p[1];
        }
        var name = "JOY_" + list[0].name;
        var j = comp.layers.addNull(comp.duration);
        j.name = name;
        j.label = 14;
        tr(j).property("ADBE Anchor Point").setValue([50, 50]);
        tr(j).property("ADBE Position").setValue([sum[0] / list.length, sum[1] / list.length]);
        var par = list[list.length - 1].parent;
        if (par) j.parent = par;
        var rest = tr(j).property("ADBE Position").value;
        ensureSlider(j, "Range px", o.range);
        ensureSlider(j, "Depth px", o.depth);
        ensureSlider(j, "Tilt°", 4);
        j.moveBefore(list[0]);

        var n = list.length;
        for (i = 0; i < n; i++) {
            var f = n > 1 ? 1 - 2 * i / (n - 1) : 1; // 手前 1 … 奥 -1
            var JOY = [
                'var j = thisComp.layer(' + jsString(name) + ');',
                'var r = j.effect("Range px")(1);',
                'var d = sub(j.transform.position, [' + rest[0] + ', ' + rest[1] + ']);',
                'var jx = clamp(d[0] / r, -1, 1), jy = clamp(d[1] / r, -1, 1);'
            ].join("\n");
            tr(list[i]).property("ADBE Position").expression = JOY + [
                '',
                'var m = j.effect("Depth px")(1) * ' + f.toFixed(3) + ';',
                'value.length > 2 ? add(value, [jx * m, jy * m, 0]) : add(value, [jx * m, jy * m])'
            ].join("\n");
            if (i === n - 1 || f < -0.99) {
                tr(list[i]).property("ADBE Rotate Z").expression = JOY + '\nvalue + jx * j.effect("Tilt°")(1)';
            }
        }
        return "ジョイスティック「" + name + "」を作りました。これを上下左右に動かす（キーを打つ）と顔の向きが変わります。\n動く量は Range px（操作の幅）/ Depth px（パーツの動く量）で調整。";
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
            b.preferredSize = [width || 140, 26];
            b.onClick = onClick;
            return b;
        }
        function note(parent, text) {
            var st = parent.add("statictext", undefined, text, { multiline: true });
            st.alignment = ["fill", "top"];
        }

        var gTop = row(w);
        var cbJoint = gTop.add("checkbox", undefined, "関節を自動セット（各パーツの上端中央）");
        cbJoint.value = true;

        var tabs = w.add("tabbedpanel");
        tabs.alignChildren = ["fill", "top"];

        // --- ボーン ---
        var tB = tabs.add("tab", undefined, "ボーン");
        tB.alignChildren = ["fill", "top"];
        note(tB, "パーツを「根元 → 先端」の順にクリックして選択してから押します（例: 体 → 上腕 → 前腕 → 手）。");
        var g = row(tB);
        btn(g, "ボーンチェーン作成", run("チェーン", function (comp) { return makeChain(comp, { autoJoint: cbJoint.value }); }), 160);
        btn(g, "呼吸（体）", run("呼吸", makeBreath), 110);
        var pS = tB.add("panel", undefined, "揺れもの（髪・リボン・スカート・耳など）");
        pS.alignChildren = ["left", "top"];
        g = row(pS);
        var etAmp = field(g, "揺れ幅(°):", "6", 4);
        var etFreq = field(g, "速さ:", "0.6", 4);
        g = row(pS);
        btn(g, "揺れものにする", run("揺れもの", function (comp) {
            return makeSwing(comp, { autoJoint: cbJoint.value, amp: num(etAmp.text, 6), freq: num(etFreq.text, 0.6) });
        }), 160);
        note(pS, "先端ほど遅れて大きく揺れ、体が動くと引っ張られてなびきます。");

        // --- IK ---
        var tI = tabs.add("tab", undefined, "IK（腕・脚）");
        tI.alignChildren = ["fill", "top"];
        note(tI, "「上腕 → 前腕 → 手」（脚は 太もも → すね → 足）の順にクリックして選択。できたコントローラー IK_… を動かすと、ひじ・ひざが自動で曲がります。");
        g = row(tI);
        var cbFollow = g.add("checkbox", undefined, "コントローラーを体に追従させる");
        cbFollow.value = true;
        g = row(tI);
        btn(g, "IKを作成", run("IK", function (comp) {
            return makeIK(comp, { autoJoint: cbJoint.value, followBody: cbFollow.value });
        }), 160);
        note(tI, "肩・ひじ・手首の位置がずれるときは「関節を自動セット」を外し、アンカーポイントを関節に手で置いてから作成してください。");

        // --- 顔 ---
        var tF = tabs.add("tab", undefined, "顔");
        tF.alignChildren = ["fill", "top"];
        var pBl = tF.add("panel", undefined, "まばたき");
        pBl.alignChildren = ["left", "top"];
        g = row(pBl);
        var etIv = field(g, "間隔(秒):", "3.5", 4);
        var etBd = field(g, "長さ(秒):", "0.12", 4);
        var cbSwap = g.add("checkbox", undefined, "開/閉 2枚を切替");
        cbSwap.value = true;
        g = row(pBl);
        btn(g, "自動まばたき", run("まばたき", function (comp) {
            return makeBlink(comp, { interval: num(etIv.text, 3.5), dur: num(etBd.text, 0.12), swap: cbSwap.value });
        }), 160);

        var pLip = tF.add("panel", undefined, "口パク（歌声に合わせる）");
        pLip.alignChildren = ["left", "top"];
        note(pLip, "ボーカル音源を「オーディオをキーフレームに変換」→ できたレイヤー名を VOICE_AMP に。口は「閉 →（半開き）→ 開」の順に選択。");
        g = row(pLip);
        var etLo = field(g, "開き始め:", "6", 4);
        var etHi = field(g, "大きく開く:", "14", 4);
        btn(g, "口パク", run("口パク", function (comp) {
            return makeLipSync(comp, { lo: num(etLo.text, 6), hi: num(etHi.text, 14) });
        }), 90);

        var pJ = tF.add("panel", undefined, "顔の向き ジョイスティック（2.5D）");
        pJ.alignChildren = ["left", "top"];
        note(pJ, "顔パーツを選択（上ほど手前: 前髪・目・口… 下ほど奥: 輪郭・後ろ髪）。");
        g = row(pJ);
        var etRange = field(g, "操作幅(px):", "100", 4);
        var etDepth = field(g, "動く量(px):", "25", 4);
        btn(g, "作成", run("ジョイスティック", function (comp) {
            return makeJoystick(comp, { range: num(etRange.text, 100), depth: num(etDepth.text, 25) });
        }), 70);

        tabs.selection = tB;
        w.onResizing = w.onResize = function () { this.layout.resize(); };
        w.layout.layout(true);
        if (w instanceof Window) { w.center(); w.show(); }
        return w;
    }

    buildUI(thisObj);
})(this);
