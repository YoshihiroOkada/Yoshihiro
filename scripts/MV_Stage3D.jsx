#targetengine "MVStage3D"
/*
 * MV_Stage3D.jsx  -  歌ってみたMV用 3D空間（ステージ）ジェネレーター (After Effects)
 *
 * 方針は CLAUDE.md / brand/IDEA.md（参考プロンプトを例外なしで適用）:
 *   ・必須の物だけ: 夜の墓場（Aメロ）、仮面舞踏会（サビ）、仮面。本物の背景イラストはパノラマで使う
 *   ・色はトークンだけ。アクセント（#E8823A）は「灯」だけに使う。グロー・霧・パーティクル・ゆらめき無し
 *   ・場面は差し替えずに変形する: 墓石と木は地面に沈み、柱は床から上がり、シャンデリアは降りてくる。
 *     カボチャの中の灯は、そのまま上へ昇って舞踏会の灯になる（同じ物が場面をまたいで生き続ける）
 *   ・冒頭の絵（Question）と最後の絵（Payoff）: 地面に置かれた仮面
 *   ・カメラが飛び続けても途切れないよう、カメラの周りで配置し直す（時間の純関数・乱数はシード固定）
 *
 * 使い方: Scripts/ScriptUI Panels に MV_Tokens.jsxinc と一緒に入れ、「ウィンドウ」メニューから開く
 */
#include "MV_Tokens.jsxinc"

(function (thisObj) {
    var NAME = "MV Stage 3D";
    var VERSION = "2.0.0";
    var PREFIX = "STG_";
    var T = MV_TOKENS;
    var C = T.color;
    var SECTIONS_LAYER = PREFIX + "SECTIONS";

    // =====================================================================
    // ユーティリティ
    // =====================================================================
    function num(v, fallback) {
        var n = parseFloat(v);
        return isNaN(n) ? fallback : n;
    }

    function rgba(c) { return [c[0], c[1], c[2], 1]; }
    function tr(layer) { return layer.property("ADBE Transform Group"); }
    function f3(v) { return Math.round(v * 1000) / 1000; }

    function findLayer(comp, name) {
        for (var i = 1; i <= comp.numLayers; i++) if (comp.layer(i).name === name) return comp.layer(i);
        return null;
    }

    function findComp(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }

    // 基準点: カメラリグのターゲット > コンポ中央
    function sceneBase(comp) {
        var ctrl = findLayer(comp, "CAM_CONTROL");
        if (ctrl) {
            try { return ctrl.property("ADBE Effect Parade").property("Target").property(1).valueAtTime(comp.time, false); } catch (e) {}
        }
        return [comp.width / 2, comp.height / 2, 0];
    }

    function camDistance(comp) {
        var cam = comp.activeCamera;
        if (cam) {
            try {
                var z = cam.property("ADBE Camera Options Group").property("ADBE Camera Zoom").valueAtTime(comp.time, false);
                if (z > 0) return z;
            } catch (e) {}
        }
        return comp.width * 0.95;
    }

    // 作ったレイヤー: シャイにして、地（2D の BG_GROUND）のすぐ上に並べる
    function finish(comp, layers) {
        var bg = findLayer(comp, "BG_GROUND");
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i];
            L.shy = true;
            L.label = 13;
            if (bg && L !== bg) L.moveBefore(bg);
            else if (!bg) L.moveToEnd();
        }
        comp.hideShyLayers = true;
        return layers.length;
    }

    // =====================================================================
    // シェイプの部品（座標はレイヤー中央が原点。先に作ったグループほど手前）
    // =====================================================================
    function shapeGroup(sl, name) {
        var root = sl.property("ADBE Root Vectors Group");
        var gi = root.addProperty("ADBE Vector Group").propertyIndex;
        root.property(gi).name = name || "G";
        return gi;
    }

    function vecs(sl, gi) {
        return sl.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
    }

    function paint(sl, gi, o) {
        if (o.fill) vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
        if (o.stroke) vecs(sl, gi).addProperty("ADBE Vector Graphic - Stroke");
        var v = vecs(sl, gi);
        if (o.fill) v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(o.fill));
        if (o.stroke) {
            var st = v.property("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(rgba(o.stroke));
            st.property("ADBE Vector Stroke Width").setValue(o.width || 4);
            try { st.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
        }
    }

    function pathGroup(sl, name, verts, o) {
        o = o || {};
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Group");
        var s = new Shape();
        s.vertices = verts;
        if (o.inT) s.inTangents = o.inT;
        if (o.outT) s.outTangents = o.outT;
        s.closed = o.open ? false : true;
        vecs(sl, gi).property("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(s);
        paint(sl, gi, o);
        return gi;
    }

    function ellipseGroup(sl, name, center, size, o) {
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Ellipse");
        var e = vecs(sl, gi).property("ADBE Vector Shape - Ellipse");
        e.property("ADBE Vector Ellipse Size").setValue(size);
        e.property("ADBE Vector Ellipse Position").setValue(center);
        paint(sl, gi, o);
        return gi;
    }

    function rectGroup(sl, name, center, size, o) {
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Rect");
        var r = vecs(sl, gi).property("ADBE Vector Shape - Rect");
        r.property("ADBE Vector Rect Size").setValue(size);
        r.property("ADBE Vector Rect Position").setValue(center);
        if (o.round) r.property("ADBE Vector Rect Roundness").setValue(o.round);
        paint(sl, gi, o);
        return gi;
    }

    function propComp(comp, name, w, h) {
        return app.project.items.addComp(name, w, h, 1, comp.duration + 10, comp.frameRate);
    }

    function polyMask(layer, pts) {
        var s = new Shape();
        s.vertices = pts;
        s.closed = true;
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(s);
        return m;
    }

    // =====================================================================
    // 小物（トークンの色だけ。アクセントは灯だけ）
    // =====================================================================
    var LINE_W = 6;

    function propTomb(comp, cross) {
        var name = cross ? "PROP_CROSS" : "PROP_TOMB";
        var pc = findComp(name);
        if (pc) return pc;
        pc = propComp(comp, name, 320, 460);
        var s = pc.layers.addShape();
        s.name = "stone";
        if (cross) {
            rectGroup(s, "h", [0, -90], [250, 64], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
            rectGroup(s, "v", [0, 20], [64, 420], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        } else {
            pathGroup(s, "crack", [[-80, 70], [-58, 115], [-86, 155], [-64, 200]], { stroke: C.line, width: 5, open: true });
            // 上が半円の墓石を1本のパスで（継ぎ目の線が出ない）
            pathGroup(s, "stone", [[-125, 230], [-125, -75], [0, -200], [125, -75], [125, 230]], {
                fill: C.groundRaised, stroke: C.line, width: LINE_W,
                inT: [[0, 0], [0, 0], [-69, 0], [0, -69], [0, 0]],
                outT: [[0, 0], [0, -69], [69, 0], [0, 0], [0, 0]] });
        }
        return pc;
    }

    function propTree(comp) {
        var pc = findComp("PROP_TREE");
        if (pc) return pc;
        pc = propComp(comp, "PROP_TREE", 1400, 1400);
        var s = pc.layers.addShape();
        s.name = "tree";
        var rng = new MvRng(666);
        var count = 0;
        function branch(x, y, ang, len, width, depth) {
            var rad = ang * Math.PI / 180;
            var x2 = x + Math.cos(rad) * len, y2 = y + Math.sin(rad) * len;
            var mx = (x + x2) / 2 + rng.range(-len, len) * 0.12, my = (y + y2) / 2 + rng.range(-len, len) * 0.12;
            pathGroup(s, "b" + (count++), [[x, y], [mx, my], [x2, y2]], { stroke: C.line, width: width, open: true });
            if (depth <= 0) return;
            var kids = depth > 3 ? 2 : (rng.next() < 0.5 ? 2 : 3);
            for (var i = 0; i < kids; i++) {
                var a2 = ang + (i - (kids - 1) / 2) * 52 + rng.range(-18, 18);
                a2 += (-90 - a2) * 0.1;
                branch(x2, y2, a2, len * rng.range(0.7, 0.82), Math.max(3, width * 0.6), depth - 1);
            }
        }
        branch(0, 700, -90, 360, 70, 5);
        pathGroup(s, "roots", [[-110, 700], [-30, 620], [30, 620], [120, 700]], { fill: C.line });
        return pc;
    }

    // カボチャの殻（灯は別レイヤー: 場面が変わると灯だけが抜け出して昇る）
    function propPumpkin(comp) {
        var pc = findComp("PROP_PUMPKIN");
        if (pc) return pc;
        pc = propComp(comp, "PROP_PUMPKIN", 420, 400);
        var s = pc.layers.addShape();
        s.name = "shell";
        pathGroup(s, "stem", [[-14, -95], [14, -95], [22, -160], [2, -170]], { fill: C.line });
        ellipseGroup(s, "center", [0, 20], [190, 275], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        ellipseGroup(s, "midL", [-62, 25], [200, 260], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        ellipseGroup(s, "midR", [62, 25], [200, 260], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        ellipseGroup(s, "outerL", [-120, 30], [170, 230], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        ellipseGroup(s, "outerR", [120, 30], [170, 230], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        return pc;
    }

    // 灯（唯一のアクセント）。カボチャの顔として見え、昇ると舞踏会の灯になる
    function propLight(comp) {
        var pc = findComp("PROP_LIGHT");
        if (pc) return pc;
        pc = propComp(comp, "PROP_LIGHT", 420, 400);
        var s = pc.layers.addShape();
        s.name = "light";
        pathGroup(s, "eyeL", [[-100, -10], [-40, -10], [-72, -70]], { fill: C.accent });
        pathGroup(s, "eyeR", [[40, -10], [100, -10], [72, -70]], { fill: C.accent });
        pathGroup(s, "mouth", [[-120, 55], [-88, 72], [-64, 58], [-42, 82], [-16, 64], [0, 88], [16, 64], [42, 82], [64, 58],
            [88, 72], [120, 55], [96, 108], [44, 130], [0, 136], [-44, 130], [-96, 108]], { fill: C.accent });
        return pc;
    }

    function propFlame(comp) {
        var pc = findComp("PROP_FLAME");
        if (pc) return pc;
        pc = propComp(comp, "PROP_FLAME", 120, 200);
        var s = pc.layers.addShape();
        s.name = "flame";
        pathGroup(s, "flame", [[0, -80], [36, 30], [0, 80], [-36, 30]], {
            fill: C.accent,
            inT: [[-10, 30], [0, -40], [30, 0], [0, 30]],
            outT: [[10, 30], [0, 30], [-30, 0], [0, -40]] });
        return pc;
    }

    function propPillar(comp) {
        var pc = findComp("PROP_PILLAR");
        if (pc) return pc;
        pc = propComp(comp, "PROP_PILLAR", 420, 1700);
        var s = pc.layers.addShape();
        s.name = "pillar";
        rectGroup(s, "capTop", [0, -770], [330, 50], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        rectGroup(s, "capNeck", [0, -720], [270, 44], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        rectGroup(s, "baseTop", [0, 725], [270, 44], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        rectGroup(s, "baseBottom", [0, 780], [340, 70], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        for (var i = 0; i < 4; i++) rectGroup(s, "flute" + i, [-54 + i * 36, 0], [8, 1360], { fill: C.line });
        rectGroup(s, "shaft", [0, 0], [230, 1420], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        return pc;
    }

    function propChandelier(comp) {
        var pc = findComp("PROP_CHANDELIER");
        if (pc) return pc;
        pc = propComp(comp, "PROP_CHANDELIER", 1000, 900);
        var s = pc.layers.addShape();
        s.name = "frame";
        var tips = [[-360, 60], [-200, 90], [200, 90], [360, 60], [-250, -60], [-90, -40], [90, -40], [250, -60]];
        var i;
        for (i = 0; i < tips.length; i++) {
            rectGroup(s, "cup" + i, [tips[i][0], tips[i][1] + 2], [44, 12], { fill: C.muted });
        }
        for (i = 0; i < tips.length; i++) {
            var tx = tips[i][0], ty = tips[i][1];
            var mx = tx * 0.6, my = ty + (ty > 0 ? 120 : 150);
            pathGroup(s, "arm" + i, [[0, 30], [mx, my], [tx, ty]], {
                stroke: C.line, width: 11, open: true,
                inT: [[0, 0], [-tx * 0.3, 0], [0, 50]], outT: [[tx * 0.15, 40], [tx * 0.3, 0], [0, 0]] });
        }
        pathGroup(s, "bowl", [[-110, 20], [110, 20], [60, 110], [0, 140], [-60, 110]], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        ellipseGroup(s, "body", [0, -60], [110, 170], { fill: C.groundRaised, stroke: C.line, width: LINE_W });
        rectGroup(s, "chain", [0, -300], [12, 320], { fill: C.line });
        return pc;
    }

    function propDancers(comp) {
        var pc = findComp("PROP_DANCERS");
        if (pc) return pc;
        pc = propComp(comp, "PROP_DANCERS", 700, 1000);
        var s = pc.layers.addShape();
        s.name = "dancers";
        var f = { fill: C.line };
        ellipseGroup(s, "headW", [55, -350], [66, 82], f);
        pathGroup(s, "hairW", [[20, -370], [55, -400], [95, -380], [100, -330], [80, -300]], f);
        pathGroup(s, "torsoW", [[30, -305], [85, -305], [90, -160], [25, -160]], f);
        pathGroup(s, "gown", [[25, -170], [95, -170], [260, 470], [120, 440], [0, 480], [-120, 450], [-150, 470]], f);
        ellipseGroup(s, "headM", [-70, -410], [70, 86], f);
        pathGroup(s, "torsoM", [[-120, -360], [-20, -360], [-10, -60], [-130, -60]], f);
        pathGroup(s, "legs", [[-130, -70], [-10, -70], [-20, 480], [-60, 480], [-70, 60], [-90, 480], [-130, 480]], f);
        pathGroup(s, "armM", [[-30, -330], [30, -250], [60, -230]], { stroke: C.line, width: 30, open: true });
        pathGroup(s, "armHold", [[-120, -335], [-200, -330], [-215, -385]], { stroke: C.line, width: 24, open: true });
        pathGroup(s, "armW", [[35, -290], [-60, -300], [-190, -390]], { stroke: C.line, width: 20, open: true });
        return pc;
    }

    // 物語の中心の物: 仮面（冒頭と最後の絵）
    function propMask(comp) {
        var pc = findComp("PROP_MASK");
        if (pc) return pc;
        pc = propComp(comp, "PROP_MASK", 700, 360);
        var s = pc.layers.addShape();
        s.name = "mask";
        ellipseGroup(s, "eyeL", [-95, 30], [112, 58], { fill: C.ground, stroke: C.ink, width: 5 });
        ellipseGroup(s, "eyeR", [95, 30], [112, 58], { fill: C.ground, stroke: C.ink, width: 5 });
        pathGroup(s, "mask", [[-240, 0], [-160, -60], [-60, -40], [0, -10], [60, -40], [160, -60], [240, 0], [210, 70],
            [130, 110], [50, 80], [0, 100], [-50, 80], [-130, 110], [-210, 70]], { fill: C.groundRaised, stroke: C.ink, width: 7 });
        return pc;
    }

    function propMoon(comp) {
        var pc = findComp("PROP_MOON");
        if (pc) return pc;
        pc = propComp(comp, "PROP_MOON", 800, 800);
        var s = pc.layers.addShape();
        s.name = "moon";
        ellipseGroup(s, "c1", [-120, -90], [130, 110], { fill: C.line });
        ellipseGroup(s, "c2", [110, 60], [170, 150], { fill: C.line });
        ellipseGroup(s, "disc", [0, 0], [600, 600], { fill: C.muted });
        return pc;
    }

    // =====================================================================
    // エクスプレッション（時間の純関数）
    // =====================================================================
    // サビの度合い g（0=墓場、1=舞踏会）。STG_SECTIONS が無ければ 0
    var GATE = 'var g = 0;\ntry { g = clamp(thisComp.layer("' + SECTIONS_LAYER + '").effect("Chorus")(1) / 100, 0, 1); } catch (err) {}';

    // カメラの周りで Z 方向に配置し直す + 場面による上下の移動（yExpr は g を使える）
    function exprPlace(len, lead, yExpr) {
        return [
            GATE,
            'var v = add(value, [0, ' + yExpr + ', 0]);',
            'try {',
            '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  var L = ' + f3(len) + ', lead = ' + f3(lead) + ';',
            '  var d = ((v[2] - cp[2] + lead) % L + L) % L;',
            '  [v[0], v[1], cp[2] + d - lead];',
            '} catch (err) { v; }'
        ].join("\n");
    }

    // 顔（灯）は前半で消え、同じ場所・同じ動きの炎が前半で現れる → 灯が形を変えて昇って見える
    var EXPR_FACE_OPACITY = GATE + '\nvalue * (1 - clamp(g / 0.4, 0, 1))';
    var EXPR_FLAME_OPACITY = GATE + '\nvalue * clamp(g / 0.4, 0, 1)';

    // =====================================================================
    // 空間: 墓場（Aメロ）→ 仮面舞踏会（サビ）
    // =====================================================================
    function placeProp(comp, item, name, pos, scale, o) {
        var L = comp.layers.add(item, comp.duration);
        L.name = PREFIX + name;
        L.threeDLayer = true;
        var ay = o.top ? 0 : (o.center ? item.height / 2 : item.height);
        tr(L).property("ADBE Anchor Point").setValue([item.width / 2, ay, 0]);
        tr(L).property("ADBE Position").setValue(pos);
        tr(L).property("ADBE Scale").setValue([scale, scale, 100]);
        if (o.len) tr(L).property("ADBE Position").expression = exprPlace(o.len, o.lead, o.y || "0");
        return L;
    }

    function buildHalloween(comp, o) {
        var base = sceneBase(comp);
        var W = comp.width, H = comp.height;
        var k = W / 1920;
        var floorY = base[1] + H * 0.36;
        var ceilY = floorY - 2300 * k;
        var rng = new MvRng(o.seed);
        var n = Math.max(4, Math.round(o.count / 2));
        var spacing = 1100 * k, len = n * spacing, lead = spacing * 1.5;
        var made = [];

        // 床（場面をまたいで残る）。カメラの真下に付いてくる
        var floor = comp.layers.addSolid(C.groundRaised, PREFIX + "FLOOR", Math.round(14000 * k), Math.round(14000 * k), 1, comp.duration);
        floor.threeDLayer = true;
        tr(floor).property("ADBE Rotate X").setValue(90);
        tr(floor).property("ADBE Position").setValue([base[0], floorY, base[2]]);
        tr(floor).property("ADBE Position").expression =
            'try { var p = thisComp.activeCamera.toWorld([0, 0, 0]); [p[0], value[1], p[2] + ' + f3(4000 * k) + ']; } catch (err) { value; }';
        made.push(floor);

        // 月（どこへ飛んでも同じ位置に見える）
        var moon = comp.layers.add(propMoon(comp), comp.duration);
        moon.name = PREFIX + "MOON";
        moon.threeDLayer = true;
        tr(moon).property("ADBE Position").setValue([2200 * k, -2300 * k, 9000 * k]);
        tr(moon).property("ADBE Position").expression = 'try { add(value, thisComp.activeCamera.toWorld([0, 0, 0])); } catch (err) { value; }';
        tr(moon).property("ADBE Scale").setValue([220 * k, 220 * k, 100]);
        made.push(moon);

        // 冒頭と最後の絵: 地面に置かれた仮面（歌詞ビルダーの冒頭の構図の中）
        made.push(placeProp(comp, propMask(comp), "MASK_OPENING", [base[0] + W * 0.12, floorY, base[2] + 200 * k], 70 * k, {}));

        var tomb = propTomb(comp, false), cross = propTomb(comp, true), tree = propTree(comp);
        var pump = propPumpkin(comp), light = propLight(comp), flame = propFlame(comp);
        var pillar = propPillar(comp), chand = propChandelier(comp), dancers = propDancers(comp);

        // 沈む量・上がる量（場面の変化を「場所の移動」で見せる）
        var sinkTomb = 'g * ' + f3(470 * k);
        var sinkTree = 'g * ' + f3(1500 * k);
        var risePillar = '(1 - g) * ' + f3(1900 * k);
        var dropChand = '-(1 - g) * ' + f3(1500 * k);

        for (var i = 0; i < n; i++) {
            var z = base[2] + (i + 1) * spacing;
            for (var side = -1; side <= 1; side += 2) {
                var sn = side < 0 ? "L" : "R";
                var zz = z + rng.range(-200, 200) * k;
                // 墓場（Aメロ）
                var r = rng.next();
                if (r < 0.55) {
                    made.push(placeProp(comp, r < 0.38 ? tomb : cross, "GRAVE_" + sn + (i + 1),
                        [base[0] + side * rng.range(500, 1500) * k, floorY, zz], rng.range(70, 105) * k, { len: len, lead: lead, y: sinkTomb }));
                } else {
                    made.push(placeProp(comp, tree, "TREE_" + sn + (i + 1),
                        [base[0] + side * rng.range(1700, 2700) * k, floorY, zz], rng.range(120, 190) * k, { len: len, lead: lead, y: sinkTree }));
                }
                // カボチャと灯: 殻は沈み、灯は昇って舞踏会の灯になる
                var px = base[0] + side * rng.range(380, 900) * k, pz = z + spacing / 2;
                var ps = rng.range(50, 80) * k;
                made.push(placeProp(comp, pump, "PUMPKIN_" + sn + (i + 1), [px, floorY, pz], ps, { len: len, lead: lead, y: sinkTomb }));
                var lightY = floorY - (400 - 200 - 30) * ps / 100;  // 殻（下端基準）の顔の中心の高さ
                var climb = lightY - (ceilY + 700 * k);              // シャンデリアの高さまで昇る
                var rise = '-g * ' + f3(climb);
                // 灯の素材は殻と同じ寸法なので、同じ下端・同じ位置に置けば顔にぴったり重なる
                var lt = placeProp(comp, light, "LIGHT_" + sn + (i + 1), [px, floorY, pz - 2], ps, { len: len, lead: lead, y: rise });
                tr(lt).property("ADBE Opacity").expression = EXPR_FACE_OPACITY;
                var fl = placeProp(comp, flame, "FLAME_" + sn + (i + 1), [px, lightY, pz - 4], ps * 0.6, { center: true, len: len, lead: lead, y: rise });
                tr(fl).property("ADBE Opacity").expression = EXPR_FLAME_OPACITY;
                made.push(lt);
                made.push(fl);
                // 舞踏会（サビ）: 柱は床の下から上がる
                made.push(placeProp(comp, pillar, "PILLAR_" + sn + (i + 1),
                    [base[0] + side * 1500 * k, floorY, z], 110 * k, { len: len, lead: lead, y: risePillar }));
            }
            if (i % 2 === 0) {
                made.push(placeProp(comp, chand, "CHANDELIER_" + (i / 2 + 1), [base[0], ceilY, z + spacing / 2], 120 * k,
                    { top: true, len: len, lead: lead, y: dropChand }));
            } else {
                var sx = (i % 4 === 1 ? -1 : 1) * rng.range(300, 900) * k;
                made.push(placeProp(comp, dancers, "DANCERS_" + (i + 1), [base[0] + sx, floorY, z], rng.range(85, 105) * k,
                    { len: len, lead: lead, y: risePillar }));
            }
        }
        return made;
    }

    // =====================================================================
    // 場面の切り替え（サビ = 歌詞の ! 行 または ワークエリア）
    // =====================================================================
    function chorusRanges(comp) {
        var r = [];
        for (var i = 1; i <= comp.numLayers; i++) {
            var L = comp.layer(i);
            if (/^LYRIC_\d+_!$/.test(L.name)) r.push([L.inPoint, L.outPoint]);
        }
        r.sort(function (a, b) { return a[0] - b[0]; });
        var out = [];
        for (i = 0; i < r.length; i++) {
            if (out.length && r[i][0] - out[out.length - 1][1] < 1.5) out[out.length - 1][1] = Math.max(out[out.length - 1][1], r[i][1]);
            else out.push([r[i][0], r[i][1]]);
        }
        return out;
    }

    // 0→100 の切り替えを settle イージングで（バウンスしない）
    function setSections(comp, ranges) {
        var host = findLayer(comp, SECTIONS_LAYER);
        if (!host) {
            host = comp.layers.addNull(comp.duration);
            host.name = SECTIONS_LAYER;
            host.label = 2;
        }
        if (!host.property("ADBE Effect Parade").property("Chorus")) {
            var fx = host.property("ADBE Effect Parade").addProperty("ADBE Slider Control");
            fx.name = "Chorus";
        }
        var p = host.property("ADBE Effect Parade").property("Chorus").property(1);
        while (p.numKeys > 0) p.removeKey(1);
        var d = T.motion.cameraMove * 2;
        p.setValueAtTime(0, 0);
        for (var i = 0; i < ranges.length; i++) {
            var a = Math.max(0.01, ranges[i][0] - d), b = ranges[i][1];
            p.setValueAtTime(a, 0);
            p.setValueAtTime(a + d, 100);
            p.setValueAtTime(Math.max(a + d + 0.01, b), 100);
            p.setValueAtTime(Math.max(a + d + 0.02, b + d), 0);
        }
        for (var k = 1; k <= p.numKeys; k++) {
            p.setInterpolationTypeAtKey(k, KeyframeInterpolationType.BEZIER, KeyframeInterpolationType.BEZIER);
            p.setTemporalEaseAtKey(k, [new KeyframeEase(0, T.motion.settleIn)], [new KeyframeEase(0, T.motion.settleOut)]);
        }
        host.shy = true;
        return host;
    }

    // =====================================================================
    // パノラマ: 本物の背景イラストを円柱に巻く
    // =====================================================================
    function buildPanorama(comp, o) {
        var sel = comp.selectedLayers;
        if (sel.length !== 1 || !(sel[0] instanceof AVLayer) || !sel[0].source) {
            throw new Error("背景イラスト（横長の画像）のレイヤーを1つ選択してください。\n（360°パノラマ画像なら継ぎ目なく一周します）");
        }
        var src = sel[0];
        var r = src.sourceRectAtTime(comp.time, false);
        var iw = r.width, ih = r.height;
        var n = Math.max(8, o.count);
        var sw = iw / n;
        var base = sceneBase(comp);
        var R = Math.max(iw / (2 * Math.PI), camDistance(comp) * 1.6);
        var k = R / (iw / (2 * Math.PI));
        var center = "[" + f3(base[0]) + ", " + f3(base[1]) + ", " + f3(base[2]) + "]";
        var made = [];
        for (var i = 0; i < n; i++) {
            var L = src.duplicate();
            L.name = PREFIX + "PANO_" + (i + 1);
            L.enabled = true;
            L.parent = null;
            var x0 = r.left + i * sw - 1, x1 = r.left + (i + 1) * sw + 1;
            polyMask(L, [[x0, r.top], [x1, r.top], [x1, r.top + ih], [x0, r.top + ih]]);
            L.threeDLayer = true;
            tr(L).property("ADBE Anchor Point").setValue([r.left + (i + 0.5) * sw, r.top + ih / 2, 0]);
            var th = ((i + 0.5) / n - 0.5) * 2 * Math.PI;
            tr(L).property("ADBE Position").setValue([base[0] + R * Math.sin(th), base[1], base[2] + R * Math.cos(th)]);
            tr(L).property("ADBE Scale").setValue([k * 100 * 1.004, k * 100, 100]);
            tr(L).property("ADBE Orientation").expression = 'lookAt(' + center + ', position)';
            made.push(L);
        }
        src.enabled = false;
        return made;
    }

    function removeStage(comp) {
        var n = 0;
        for (var i = comp.numLayers; i >= 1; i--) {
            var L = comp.layer(i);
            if (L.name.indexOf(PREFIX) === 0) {
                if (L.locked) L.locked = false;
                L.remove();
                n++;
            }
        }
        return n + " 個の STG_ レイヤーを削除しました。";
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

    function generate(comp, o) {
        var ranges = o.useWorkArea ? [[comp.workAreaStart, comp.workAreaStart + comp.workAreaDuration]] : chorusRanges(comp);
        var made = buildHalloween(comp, o);
        made.push(setSections(comp, ranges));
        finish(comp, made);
        var list = [];
        for (var i = 0; i < ranges.length; i++) list.push(ranges[i][0].toFixed(1) + "〜" + ranges[i][1].toFixed(1) + "秒");
        return made.length + " 個のレイヤーを作りました。\nサビ（舞踏会）: " +
            (list.length ? list.join(" / ") : "見つかりません（墓場のまま）。! 行のある歌詞ビルダーのコンポで実行するか、ワークエリアを選んでください");
    }

    function buildUI(thisObj) {
        var w = (thisObj instanceof Panel) ? thisObj : new Window("palette", NAME + " v" + VERSION, undefined, { resizeable: true });
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
        function note(parent, text) {
            var st = parent.add("statictext", undefined, text, { multiline: true });
            st.alignment = ["fill", "top"];
        }

        var p1 = w.add("panel", undefined, "墓場（Aメロ）→ 仮面舞踏会（サビ）");
        p1.alignChildren = ["left", "top"];
        note(p1, "歌詞ビルダーで作ったコンポで実行。サビに入ると墓石と木が沈み、柱が上がり、カボチャの灯が昇って舞踏会の灯になります。");
        var g = row(p1);
        var etCount = field(g, "小物の数:", "16", 4);
        var etSeed = field(g, "シード:", "7", 4);
        g = row(p1);
        g.add("statictext", undefined, "サビの区間:");
        var ddSec = g.add("dropdownlist", undefined, ["歌詞の ! 行", "ワークエリア"]);
        ddSec.selection = 0;
        g = row(p1);
        var bMake = g.add("button", undefined, "空間を生成");
        bMake.preferredSize = [140, 28];
        bMake.onClick = run("空間", function (comp) {
            return generate(comp, {
                count: Math.max(4, Math.min(80, Math.round(num(etCount.text, 16)))),
                seed: num(etSeed.text, 7), useWorkArea: ddSec.selection.index === 1
            });
        });

        var p2 = w.add("panel", undefined, "パノラマ背景（本物のイラスト）");
        p2.alignChildren = ["left", "top"];
        note(p2, "横長の背景イラストのレイヤーを選択して実行。円柱に巻いて、中から見回せる空間にします。");
        g = row(p2);
        var etDiv = field(g, "分割数:", "16", 4);
        var bPano = g.add("button", undefined, "パノラマを作る");
        bPano.onClick = run("パノラマ", function (comp) {
            var made = buildPanorama(comp, { count: Math.max(8, Math.min(64, Math.round(num(etDiv.text, 16)))) });
            finish(comp, made);
            return "パノラマを作りました（" + made.length + " 分割）。元の画像レイヤーは非表示にしました。";
        });

        g = row(w);
        var bDel = g.add("button", undefined, "STG_ を全部削除");
        bDel.onClick = run("削除", function (comp) {
            if (!confirm("このコンポの STG_ で始まるレイヤーを全部削除します（取り消し可）。よろしいですか？")) return null;
            return removeStage(comp);
        });

        w.onResizing = w.onResize = function () { this.layout.resize(); };
        w.layout.layout(true);
        if (w instanceof Window) { w.center(); w.show(); }
        return w;
    }

    buildUI(thisObj);
})(this);
