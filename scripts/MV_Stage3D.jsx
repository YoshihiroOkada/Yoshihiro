#targetengine "MVStage3D"
/*
 * MV_Stage3D.jsx  -  歌ってみたMV用 3D空間（ステージ）ジェネレーター (After Effects)
 *
 *   ネオントンネル / ネオン都市 / ライブステージ / 雲海＋月 / パーティクル（桜・雪・光）/ パノラマ背景
 *
 * ・「無限」がONの空間は、カメラの周りで自動的に配置し直されるので、
 *   歌詞MV（MV_LyricBuilder）のようにカメラが奥へ飛び続けても途切れません。
 * ・作ったレイヤーは名前が STG_ で始まり、シャイ（非表示）になります。
 *
 * 使い方: Scripts/ScriptUI Panels に入れて「ウィンドウ」メニューから開く（ドッキング可）
 */
(function (thisObj) {
    var NAME = "MV Stage 3D";
    var VERSION = "1.0.0";
    var PREFIX = "STG_";

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

    function f3(v) { return Math.round(v * 1000) / 1000; }
    function arr(v) { return "[" + f3(v[0]) + ", " + f3(v[1]) + ", " + f3(v[2]) + "]"; }

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

    // 作ったレイヤーの共通処理（名前・シャイ・ラベル・背景より上へ）
    var LAST_MADE = []; // 直近の生成で作ったレイヤー（表示区間の設定に使う）

    function finish(comp, layers, label) {
        var bg = findLayer(comp, "BG_GRADIENT");
        for (var j = 0; j < layers.length; j++) LAST_MADE.push(layers[j]);
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i];
            L.shy = true;
            L.label = label || 13;
            if (bg && L !== bg) L.moveBefore(bg);
            else if (!bg) L.moveToEnd();
        }
        comp.hideShyLayers = true;
        return layers.length;
    }

    function shapeGroup(sl, name) {
        var root = sl.property("ADBE Root Vectors Group");
        var gi = root.addProperty("ADBE Vector Group").propertyIndex;
        root.property(gi).name = name || "G";
        return gi;
    }

    function vecs(sl, gi) {
        return sl.property("ADBE Root Vectors Group").property(gi).property("ADBE Vectors Group");
    }

    function ellipseMask(layer, cx, cy, w, h, feather) {
        var k = 0.5523;
        var s = new Shape();
        s.vertices = [[cx, cy - h / 2], [cx + w / 2, cy], [cx, cy + h / 2], [cx - w / 2, cy]];
        s.inTangents = [[-k * w / 2, 0], [0, -k * h / 2], [k * w / 2, 0], [0, k * h / 2]];
        s.outTangents = [[k * w / 2, 0], [0, k * h / 2], [-k * w / 2, 0], [0, -k * h / 2]];
        s.closed = true;
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(s);
        if (feather) m.property("ADBE Mask Feather").setValue([feather, feather]);
        return m;
    }

    function polyMask(layer, pts, feather) {
        var s = new Shape();
        s.vertices = pts;
        s.closed = true;
        var m = layer.property("ADBE Mask Parade").addProperty("ADBE Mask Atom");
        m.property("ADBE Mask Shape").setValue(s);
        if (feather) m.property("ADBE Mask Feather").setValue([feather, feather]);
        return m;
    }

    function getDotComp(comp) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === "MV_DOT") return it;
        }
        var dot = app.project.items.addComp("MV_DOT", 64, 64, 1, Math.max(comp.duration, 60), comp.frameRate);
        var s = dot.layers.addSolid([1, 1, 1], "dot", 64, 64, 1, dot.duration);
        ellipseMask(s, 32, 32, 60, 60, 20);
        return dot;
    }

    // =====================================================================
    // エクスプレッション: カメラ周りで無限にリサイクル
    // =====================================================================
    // Z方向だけ回す（トンネル・都市・雲）。follow=true なら XY もカメラに（少し遅れて）付いてくる
    function exprRecycleZ(len, lead, follow, lag, centerXY) {
        return [
            'try {',
            '  var cp = thisComp.activeCamera.toWorld([0, 0, 0], time - ' + lag + ');',
            '  var L = ' + f3(len) + ', lead = ' + f3(lead) + ';',
            '  var d = value[2] - cp[2] + lead;',
            '  d = ((d % L) + L) % L;',
            '  var z = cp[2] + d - lead;',
            follow ? '  [value[0] + cp[0], value[1] + cp[1], z];' : '  [value[0], value[1], z];',
            '} catch (err) { ' + (follow ? 'add(value, [' + centerXY[0] + ', ' + centerXY[1] + ', 0]);' : 'value;') + ' }'
        ].join("\n");
    }

    // 建物の各面: 建物の中心 Z を基準に回す（面どうしがバラけない）
    function exprRecycleGroup(centerZ, len, lead) {
        return [
            'try {',
            '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  var L = ' + f3(len) + ', lead = ' + f3(lead) + ', bz = ' + f3(centerZ) + ';',
            '  var d = bz - cp[2] + lead;',
            '  d = ((d % L) + L) % L;',
            '  add(value, [0, 0, cp[2] + d - lead - bz]);',
            '} catch (err) { value; }'
        ].join("\n");
    }

    // 箱の中で3軸とも回す（パーティクル）: 落下 + ゆらぎ
    function exprRecycleBox(box, ahead, fallMin, fallMax, sway) {
        return [
            'seedRandom(index, true);',
            'var sp = random(' + fallMin + ', ' + fallMax + '), sw = random(0.3, 1) * ' + sway + ', fr = random(0.3, 1.2), ph = random(6.28);',
            'var p = add(value, [Math.sin(time * fr + ph) * sw, time * sp, Math.cos(time * fr * 0.7 + ph) * sw * 0.5]);',
            'try {',
            '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  var B = ' + arr(box) + ', off = [0, 0, ' + f3(ahead) + '], r = [];',
            '  for (var i = 0; i < 3; i++) {',
            '    var d = p[i] - cp[i] - off[i] + B[i] / 2;',
            '    d = ((d % B[i]) + B[i]) % B[i];',
            '    r.push(cp[i] + off[i] + d - B[i] / 2);',
            '  }',
            '  r;',
            '} catch (err) { p; }'
        ].join("\n");
    }

    function exprFadeByDistance(near, farStart, farEnd) {
        return [
            'try {',
            '  var d = length(toWorld(anchorPoint), thisComp.activeCamera.toWorld([0, 0, 0]));',
            '  value * linear(d, 0, ' + near + ', 0, 1) * linear(d, ' + farStart + ', ' + farEnd + ', 1, 0);',
            '} catch (err) { value; }'
        ].join("\n");
    }

    // =====================================================================
    // ネオントンネル
    // =====================================================================
    var TUNNEL_SHAPES = [
        { key: "circle", label: "円" },
        { key: "hex", label: "六角形" },
        { key: "square", label: "四角" },
        { key: "tri", label: "三角" }
    ];

    function buildTunnel(comp, o) {
        var base = sceneBase(comp);
        var dist = camDistance(comp);
        var n = Math.max(6, o.count);
        var gap = o.size > 0 ? o.size : 600;
        var len = n * gap;
        var radius = Math.max(900, dist * 0.75);
        var made = [];
        for (var i = 0; i < n; i++) {
            var sl = comp.layers.addShape();
            sl.name = PREFIX + "TUNNEL_" + (i + 1);
            var gi = shapeGroup(sl, "Ring");
            var v = vecs(sl, gi);
            if (o.shape === "circle") {
                v.addProperty("ADBE Vector Shape - Ellipse");
                vecs(sl, gi).property("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([radius * 2, radius * 2]);
            } else if (o.shape === "square") {
                v.addProperty("ADBE Vector Shape - Rect");
                vecs(sl, gi).property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([radius * 1.8, radius * 1.8]);
            } else {
                v.addProperty("ADBE Vector Shape - Star");
                var st = vecs(sl, gi).property("ADBE Vector Shape - Star");
                st.property("ADBE Vector Star Type").setValue(2); // 多角形
                st.property("ADBE Vector Star Points").setValue(o.shape === "tri" ? 3 : 6);
                st.property("ADBE Vector Star Outer Radius").setValue(radius);
            }
            vecs(sl, gi).addProperty("ADBE Vector Graphic - Stroke");
            var stroke = vecs(sl, gi).property("ADBE Vector Graphic - Stroke");
            stroke.property("ADBE Vector Stroke Width").setValue(o.shape === "circle" ? 10 : 12);
            stroke.property("ADBE Vector Stroke Color").setValue(rgba(o.color));
            if (o.rainbow) {
                stroke.property("ADBE Vector Stroke Color").expression =
                    'hslToRgb([((' + i + ' * 0.035 + time * 0.06) % 1 + 1) % 1, 0.9, 0.58, 1])';
            }
            sl.threeDLayer = true;
            tr(sl).property("ADBE Position").setValue([0, 0, base[2] + i * gap]);
            tr(sl).property("ADBE Position").expression = exprRecycleZ(len, gap * 1.5, true, 0.25, [base[0], base[1]]);
            tr(sl).property("ADBE Rotate Z").setValue(i * (o.shape === "circle" ? 0 : 7));
            tr(sl).property("ADBE Rotate Z").expression = 'value + time * ' + (o.spin || 0);
            tr(sl).property("ADBE Opacity").expression = exprFadeByDistance(400, len * 0.55, len * 0.9);
            made.push(sl);
        }
        for (i = 0; i < made.length; i++) {
            var g2 = addFx(made[i], "ADBE Glo2");
            setFx(g2, "ADBE Glo2-0003", 3, 30);
            setFx(g2, "ADBE Glo2-0004", 4, 1.5);
        }
        return finish(comp, made, 13);
    }

    // =====================================================================
    // ネオン都市
    // =====================================================================
    // 窓の並んだビルの面（1回作って使い回す）
    function getFaceComp(comp, color) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === "STG_BUILDING_FACE") return it;
        }
        var fw = 400, fh = 1200;
        var fc = app.project.items.addComp("STG_BUILDING_FACE", fw, fh, 1, Math.max(comp.duration, 60), comp.frameRate);
        fc.layers.addSolid([0.03, 0.04, 0.08], "wall", fw, fh, 1, fc.duration);
        var sl = fc.layers.addShape();
        sl.name = "windows";
        var gi = shapeGroup(sl, "Windows");
        vecs(sl, gi).addProperty("ADBE Vector Shape - Rect");
        vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
        vecs(sl, gi).addProperty("ADBE Vector Filter - Repeater");
        vecs(sl, gi).addProperty("ADBE Vector Filter - Repeater");
        var v = vecs(sl, gi);
        v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([26, 34]);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue([1, 0.85, 0.55, 1]);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(70);
        var r1 = v.property(3), r2 = v.property(4);
        r1.property("ADBE Vector Repeater Copies").setValue(8);
        r1.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([46, 0]);
        r2.property("ADBE Vector Repeater Copies").setValue(20);
        r2.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, 56]);
        sl.property("ADBE Root Vectors Group").property(gi).property("ADBE Vector Transform Group")
            .property("ADBE Vector Position").setValue([-161, -532]);
        // 屋上のネオンライン
        var neon = fc.layers.addSolid(color, "neon", fw, 10, 1, fc.duration);
        tr(neon).property("ADBE Position").setValue([fw / 2, 5]);
        return fc;
    }

    function buildCity(comp, o) {
        var base = sceneBase(comp);
        var face = getFaceComp(comp, o.color);
        var rng = new Rng(Math.floor(comp.time * 1000) + 11);
        var perSide = Math.max(3, Math.round(o.count / 2));
        var spacing = 900;
        var len = perSide * spacing;
        var street = 1500;
        var floorY = base[1] + 700;
        var made = [];
        for (var side = -1; side <= 1; side += 2) {
            for (var i = 0; i < perSide; i++) {
                var w = rng.range(500, 900), d = rng.range(500, 800), h = rng.range(1500, 5000);
                var cx = base[0] + side * (street + w / 2 + rng.range(0, 400));
                var cz = base[2] + i * spacing + rng.range(-100, 100);
                var cy = floorY - h / 2;
                // 前面・左右の側面（背面は見えないので省略）
                var faces = [
                    { n: "F", p: [cx, cy, cz - d / 2], ry: 0, fw: w },
                    { n: "L", p: [cx - w / 2, cy, cz], ry: 90, fw: d },
                    { n: "R", p: [cx + w / 2, cy, cz], ry: 90, fw: d }
                ];
                for (var k = 0; k < faces.length; k++) {
                    var L = comp.layers.add(face, comp.duration);
                    L.name = PREFIX + "CITY_" + (side < 0 ? "L" : "R") + (i + 1) + faces[k].n;
                    L.threeDLayer = true;
                    tr(L).property("ADBE Position").setValue(faces[k].p);
                    tr(L).property("ADBE Rotate Y").setValue(faces[k].ry);
                    tr(L).property("ADBE Scale").setValue([faces[k].fw / 400 * 100, h / 1200 * 100, 100]);
                    if (o.infinite) tr(L).property("ADBE Position").expression = exprRecycleGroup(cz, len, spacing * 1.5);
                    tr(L).property("ADBE Opacity").expression = exprFadeByDistance(1, len * 0.6, len * 0.95);
                    made.push(L);
                }
            }
        }
        // 道路のグリッド
        var grid = makeGrid(comp, PREFIX + "CITY_ROAD", street * 2 + 2000, 12000, 250, 4, o.color);
        tr(grid).property("ADBE Rotate X").setValue(90);
        tr(grid).property("ADBE Position").setValue([base[0], floorY, base[2]]);
        tr(grid).property("ADBE Position").expression = [
            'try {',
            '  var p = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  [value[0], value[1], Math.round(p[2] / 250) * 250 + 3000];',
            '} catch (err) { value; }'
        ].join("\n");
        made.push(grid);
        return finish(comp, made, 13);
    }

    // 細い長方形＋リピーターの格子（床・LED壁用）
    function makeGrid(comp, name, w, h, step, lw, color) {
        var sl = comp.layers.addShape();
        sl.name = name;
        var root = sl.property("ADBE Root Vectors Group");
        function lines(gname, rw, rh, copies, off) {
            var gi = shapeGroup(sl, gname);
            vecs(sl, gi).addProperty("ADBE Vector Shape - Rect");
            vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
            vecs(sl, gi).addProperty("ADBE Vector Filter - Repeater");
            var v = vecs(sl, gi);
            v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([rw, rh]);
            v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(color));
            var rep = v.property("ADBE Vector Filter - Repeater");
            rep.property("ADBE Vector Repeater Copies").setValue(copies);
            rep.property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue(off);
            root.property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Position")
                .setValue([-off[0] * (copies - 1) / 2, -off[1] * (copies - 1) / 2]);
        }
        lines("H", w, lw, Math.floor(h / step) + 1, [0, step]);
        lines("V", lw, h, Math.floor(w / step) + 1, [step, 0]);
        sl.threeDLayer = true;
        var glow = addFx(sl, "ADBE Glo2");
        setFx(glow, "ADBE Glo2-0003", 3, 20);
        return sl;
    }

    // =====================================================================
    // ライブステージ
    // =====================================================================
    function buildStage(comp, o) {
        var base = sceneBase(comp);
        var W = comp.width, H = comp.height;
        var floorY = base[1] + 650, backZ = base[2] + 1800;
        var made = [];

        var floor = makeGrid(comp, PREFIX + "STAGE_FLOOR", 6000, 4000, 200, 3, o.color);
        tr(floor).property("ADBE Rotate X").setValue(90);
        tr(floor).property("ADBE Position").setValue([base[0], floorY, backZ - 1500]);
        tr(floor).property("ADBE Opacity").setValue(50);
        made.push(floor);

        // LEDウォール（色が流れる）＋パネルの継ぎ目
        var ledW = W * 2.4, ledH = H * 1.5;
        var led = comp.layers.addSolid([1, 1, 1], PREFIX + "STAGE_LED", Math.round(ledW), Math.round(ledH), 1, comp.duration);
        led.threeDLayer = true;
        tr(led).property("ADBE Position").setValue([base[0], floorY - ledH / 2, backZ]);
        var ramp = addFx(led, "ADBE Ramp");
        setFx(ramp, "ADBE Ramp-0001", 1, [0, 0]);
        setFx(ramp, "ADBE Ramp-0003", 3, [ledW, ledH]);
        exprFx(ramp, "ADBE Ramp-0002", 2, 'hslToRgb([(time * 0.05) % 1, 0.85, 0.5, 1])');
        exprFx(ramp, "ADBE Ramp-0004", 4, 'hslToRgb([(time * 0.05 + 0.35) % 1, 0.85, 0.35, 1])');
        exprFx(ramp, "ADBE Ramp-0001", 1, '[Math.sin(time * 0.7) * ' + (ledW / 2) + ' + ' + (ledW / 2) + ', 0]');
        made.push(led);
        var seams = makeGrid(comp, PREFIX + "STAGE_LED_GRID", ledW, ledH, 90, 8, [0, 0, 0]);
        tr(seams).property("ADBE Position").setValue([base[0], floorY - ledH / 2, backZ - 2]);
        seams.property("ADBE Effect Parade").property(1).remove(); // 継ぎ目は光らせない
        made.push(seams);

        // スポットライトのビーム（加算・左右にスイープ）
        var beams = Math.max(2, o.count);
        var bw = 700, bl = 3200;
        for (var i = 0; i < beams; i++) {
            var b = comp.layers.addSolid([1, 1, 1], PREFIX + "STAGE_BEAM_" + (i + 1), bw, bl, 1, comp.duration);
            polyMask(b, [[bw / 2 - 18, 0], [bw / 2 + 18, 0], [bw, bl], [0, bl]], 60);
            var br = addFx(b, "ADBE Ramp");
            var hue = (i / beams + 0.55) % 1;
            setFx(br, "ADBE Ramp-0001", 1, [bw / 2, 0]);
            setFx(br, "ADBE Ramp-0003", 3, [bw / 2, bl]);
            setFx(br, "ADBE Ramp-0004", 4, [0, 0, 0, 1]);
            if (o.rainbow) exprFx(br, "ADBE Ramp-0002", 2, 'hslToRgb([' + f3(hue) + ', 0.8, 0.6, 1])');
            else setFx(br, "ADBE Ramp-0002", 2, rgba(o.color));
            b.blendingMode = BlendingMode.ADD;
            b.threeDLayer = true;
            tr(b).property("ADBE Anchor Point").setValue([bw / 2, 0, 0]);
            var x = base[0] + (i - (beams - 1) / 2) * (ledW / beams);
            tr(b).property("ADBE Position").setValue([x, floorY - ledH - 100, backZ - 200]);
            tr(b).property("ADBE Opacity").setValue(45);
            tr(b).property("ADBE Rotate Z").expression = 'value + Math.sin(time * ' + f3(0.6 + (i % 3) * 0.25) + ' + ' + i + ') * 35';
            tr(b).property("ADBE Rotate X").setValue(-20);
            made.push(b);
        }

        // もや
        var haze = comp.layers.addSolid([1, 1, 1], PREFIX + "STAGE_HAZE", 6000, 3000, 1, comp.duration);
        haze.threeDLayer = true;
        addFx(haze, "ADBE Fractal Noise");
        ellipseMask(haze, 3000, 1500, 5600, 2600, 900);
        haze.blendingMode = BlendingMode.SCREEN;
        tr(haze).property("ADBE Position").setValue([base[0], floorY - 800, backZ - 900]);
        tr(haze).property("ADBE Position").expression = 'add(value, [Math.sin(time * 0.1) * 300, 0, 0])';
        tr(haze).property("ADBE Opacity").setValue(18);
        made.push(haze);

        return finish(comp, made, 10);
    }

    // =====================================================================
    // 雲海＋月
    // =====================================================================
    function buildClouds(comp, o) {
        var base = sceneBase(comp);
        var rng = new Rng(Math.floor(comp.time * 1000) + 29);
        var n = Math.max(3, o.count);
        var gap = 1500, len = n * gap;
        var made = [];
        for (var i = 0; i < n; i++) {
            var c = comp.layers.addSolid([1, 1, 1], PREFIX + "CLOUD_" + (i + 1), 4000, 4000, 1, comp.duration);
            c.threeDLayer = true;
            var fn = addFx(c, "ADBE Fractal Noise");
            exprFx(fn, "ADBE Fractal Noise-0023", -1, 'time * 12'); // 展開（matchName が無ければ何もしない）
            ellipseMask(c, 2000, 2000, 3800, 3800, 1400);
            c.blendingMode = BlendingMode.SCREEN;
            tr(c).property("ADBE Rotate X").setValue(90);
            tr(c).property("ADBE Scale").setValue([300, 300, 100]);
            tr(c).property("ADBE Position").setValue([base[0] + rng.range(-3000, 3000), base[1] + 900 + rng.range(-120, 120), base[2] + i * gap]);
            if (o.infinite) tr(c).property("ADBE Position").expression = exprRecycleZ(len, gap * 2, false, 0, null);
            tr(c).property("ADBE Opacity").setValue(rng.range(45, 75));
            made.push(c);
        }
        // 月（どこへ飛んでも遠くに見える）
        var dot = getDotComp(comp);
        var moon = comp.layers.add(dot, comp.duration);
        moon.name = PREFIX + "MOON";
        moon.threeDLayer = true;
        moon.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
        tr(moon).property("ADBE Position").setValue([2600, -2200, 9000]);
        tr(moon).property("ADBE Position").expression = 'try { add(value, thisComp.activeCamera.toWorld([0, 0, 0])); } catch (err) { value; }';
        tr(moon).property("ADBE Scale").setValue([1400, 1400, 100]);
        var mg = addFx(moon, "ADBE Glo2");
        setFx(mg, "ADBE Glo2-0003", 3, 120);
        made.push(moon);
        return finish(comp, made, 15);
    }

    // =====================================================================
    // パーティクル（桜・雪・光の粒）
    // =====================================================================
    var PARTICLES = [
        { key: "sakura", label: "桜の花びら" },
        { key: "snow", label: "雪" },
        { key: "light", label: "光の粒（上昇）" },
        { key: "neon", label: "ネオンの欠片（回転）" }
    ];

    function buildParticles(comp, o) {
        var rng = new Rng(Math.floor(comp.time * 1000) + 47);
        var n = Math.max(10, o.count);
        var box = [6000, 3500, 7000];
        var ahead = 2500;
        var dot = null;
        var made = [];
        for (var i = 0; i < n; i++) {
            var L;
            if (o.type === "sakura" || o.type === "neon") {
                L = comp.layers.addShape();
                var gi = shapeGroup(L, "P");
                if (o.type === "sakura") {
                    vecs(L, gi).addProperty("ADBE Vector Shape - Ellipse");
                    vecs(L, gi).property("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue([34, 22]);
                } else {
                    vecs(L, gi).addProperty("ADBE Vector Shape - Rect");
                    vecs(L, gi).property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([rng.range(20, 80), 8]);
                }
                vecs(L, gi).addProperty("ADBE Vector Graphic - Fill");
                var col = o.type === "sakura" ? [1, rng.range(0.72, 0.85), rng.range(0.82, 0.92)] : o.color;
                vecs(L, gi).property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(col));
                L.threeDLayer = true;
                var axes = ["ADBE Rotate X", "ADBE Rotate Y", "ADBE Rotate Z"];
                for (var a = 0; a < 3; a++) {
                    tr(L).property(axes[a]).expression = 'seedRandom(index * 3 + ' + a + ', true);\nvalue + time * random(-160, 160)';
                }
            } else {
                dot = dot || getDotComp(comp);
                L = comp.layers.add(dot, comp.duration);
                L.threeDLayer = true;
                L.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
                if (o.type === "light") L.blendingMode = BlendingMode.ADD;
            }
            L.name = PREFIX + "PARTICLE_" + (i + 1);
            tr(L).property("ADBE Position").setValue([rng.range(-box[0] / 2, box[0] / 2), rng.range(-box[1] / 2, box[1] / 2), rng.range(-box[2] / 2, box[2] / 2)]);
            var fall = o.type === "light" ? [-90, -30] : (o.type === "snow" ? [60, 160] : [90, 220]);
            var sway = o.type === "snow" ? 60 : 180;
            tr(L).property("ADBE Position").expression = exprRecycleBox(box, ahead, fall[0], fall[1], sway);
            var sc = o.type === "light" ? rng.range(15, 60) : (o.type === "snow" ? rng.range(20, 70) : rng.range(80, 160));
            tr(L).property("ADBE Scale").setValue([sc, sc, sc]);
            tr(L).property("ADBE Opacity").setValue(rng.range(55, 100));
            if (o.type === "light") {
                tr(L).property("ADBE Opacity").expression = 'seedRandom(index, true);\nvalue * (0.5 + 0.5 * Math.sin(time * random(1, 4) + random(6.28)))';
            }
            made.push(L);
        }
        return finish(comp, made, 12);
    }

    // =====================================================================
    // パノラマ背景: 横長のイラストを円柱に巻いて、中から見回せる空間に
    // =====================================================================
    function buildPanorama(comp, o) {
        var sel = comp.selectedLayers;
        if (sel.length !== 1 || !(sel[0] instanceof AVLayer) || !sel[0].source) {
            throw new Error("背景イラスト（横長の画像）のレイヤーを1つ選択してください。\n（360°パノラマ画像なら継ぎ目なく一周します）");
        }
        var src = sel[0];
        var t = comp.time;
        var r = src.sourceRectAtTime(t, false);
        var iw = r.width, ih = r.height;
        var n = Math.max(8, o.count);
        var sw = iw / n;
        var base = sceneBase(comp);
        var dist = camDistance(comp);
        var rNat = iw / (2 * Math.PI);
        var R = Math.max(rNat, dist * 1.6);
        var k = R / rNat;
        var arc = o.fullCircle ? 360 : 180;
        var center = [base[0], base[1], base[2]];
        var made = [];
        for (var i = 0; i < n; i++) {
            var L = src.duplicate();
            L.name = PREFIX + "PANO_" + (i + 1);
            L.enabled = true;
            L.parent = null;
            var x0 = r.left + i * sw - 1, x1 = r.left + (i + 1) * sw + 1;
            polyMask(L, [[x0, r.top], [x1, r.top], [x1, r.top + ih], [x0, r.top + ih]], 0);
            L.threeDLayer = true;
            tr(L).property("ADBE Anchor Point").setValue([r.left + (i + 0.5) * sw, r.top + ih / 2, 0]);
            // 画像の中央が正面（+Z）に来るように並べる
            var th = ((i + 0.5) / n - 0.5) * arc * Math.PI / 180;
            // 半周のときは半径を広げて、画像の横幅がちょうど弧の長さになるように
            var Rr = R * 360 / arc;
            var sc = k;
            tr(L).property("ADBE Position").setValue([center[0] + Rr * Math.sin(th), center[1], center[2] + Rr * Math.cos(th)]);
            tr(L).property("ADBE Scale").setValue([sc * 100 * 1.004, sc * 100, 100]);
            tr(L).property("ADBE Rotate X").setValue(0);
            tr(L).property("ADBE Rotate Y").setValue(0);
            tr(L).property("ADBE Rotate Z").setValue(0);
            // 向きは lookAt で「円柱の中心から外向き」＝表面が内側を向く
            tr(L).property("ADBE Orientation").expression = 'lookAt(' + arr(center) + ', position)';
            made.push(L);
        }
        src.enabled = false;
        finish(comp, made, 8);
        return "パノラマを作りました（" + n + " 分割、半径 " + Math.round(R) + "px）。\nカメラリグの Orbit を回すと、背景をぐるっと見回せます。元の画像レイヤーは非表示にしました。";
    }

    // =====================================================================
    // ハロウィン: 小物（プリコンポ。1回作ってどの空間でも使い回す）
    // =====================================================================
    var HW = {
        orange: [1, 0.48, 0.1], orangeDark: [0.72, 0.26, 0.04], face: [1, 0.85, 0.3],
        stone: [0.36, 0.35, 0.41], stoneDark: [0.17, 0.16, 0.22], ink: [0.05, 0.02, 0.07],
        purple: [0.55, 0.32, 0.82], moon: [1, 0.92, 0.68], ghost: [0.94, 0.96, 1]
    };

    function findComp(name) {
        for (var i = 1; i <= app.project.numItems; i++) {
            var it = app.project.item(i);
            if (it instanceof CompItem && it.name === name) return it;
        }
        return null;
    }

    function propComp(comp, name, w, h) {
        var pc = app.project.items.addComp(name, w, h, 1, comp.duration + 10, comp.frameRate);
        return pc;
    }

    // シェイプに「パス＋塗り(＋線)」のグループを追加。座標はレイヤー中央が原点
    function pathGroup(sl, name, verts, o) {
        o = o || {};
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Group");
        if (o.fill) vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
        if (o.stroke) vecs(sl, gi).addProperty("ADBE Vector Graphic - Stroke");
        var s = new Shape();
        s.vertices = verts;
        if (o.inT) s.inTangents = o.inT;
        if (o.outT) s.outTangents = o.outT;
        s.closed = o.open ? false : true;
        var v = vecs(sl, gi);
        v.property("ADBE Vector Shape - Group").property("ADBE Vector Shape").setValue(s);
        if (o.fill) {
            v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(o.fill));
            if (o.fillOpacity !== undefined) v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(o.fillOpacity);
        }
        if (o.stroke) {
            var st = v.property("ADBE Vector Graphic - Stroke");
            st.property("ADBE Vector Stroke Color").setValue(rgba(o.stroke));
            st.property("ADBE Vector Stroke Width").setValue(o.width || 4);
            try { st.property("ADBE Vector Stroke Line Cap").setValue(2); } catch (e) {}
        }
        return gi;
    }

    function ellipseGroup(sl, name, center, size, fill, o) {
        o = o || {};
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Ellipse");
        vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
        if (o.stroke) vecs(sl, gi).addProperty("ADBE Vector Graphic - Stroke");
        var v = vecs(sl, gi);
        v.property("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Size").setValue(size);
        v.property("ADBE Vector Shape - Ellipse").property("ADBE Vector Ellipse Position").setValue(center);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(fill));
        if (o.opacity !== undefined) v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(o.opacity);
        if (o.stroke) {
            v.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Color").setValue(rgba(o.stroke));
            v.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Width").setValue(o.width || 4);
        }
        return gi;
    }

    function rectGroup(sl, name, center, size, fill, o) {
        o = o || {};
        var gi = shapeGroup(sl, name);
        vecs(sl, gi).addProperty("ADBE Vector Shape - Rect");
        vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
        if (o.stroke) vecs(sl, gi).addProperty("ADBE Vector Graphic - Stroke");
        var v = vecs(sl, gi);
        v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue(size);
        v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Position").setValue(center);
        if (o.round) v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Roundness").setValue(o.round);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(fill));
        if (o.stroke) {
            v.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Color").setValue(rgba(o.stroke));
            v.property("ADBE Vector Graphic - Stroke").property("ADBE Vector Stroke Width").setValue(o.width || 4);
        }
        return gi;
    }

    function glowFx(layer, radius, intensity) {
        var g = addFx(layer, "ADBE Glo2");
        setFx(g, "ADBE Glo2-0002", 2, 40);
        setFx(g, "ADBE Glo2-0003", 3, radius);
        setFx(g, "ADBE Glo2-0004", 4, intensity);
        return g;
    }

    var FLICKER = 'value * (0.78 + 0.22 * noise(time * 7 + index * 13))';

    function hwPumpkin(comp) {
        var pc = findComp("HW_PUMPKIN");
        if (pc) return pc;
        pc = propComp(comp, "HW_PUMPKIN", 420, 400);
        var body = pc.layers.addShape();
        body.name = "body";
        // シェイプは「先に作ったグループほど手前」なので、手前から順に作る
        pathGroup(body, "stem", [[-14, -95], [14, -95], [22, -160], [2, -170]], { fill: [0.3, 0.24, 0.1] });
        ellipseGroup(body, "center", [0, 20], [190, 275], HW.orange, { stroke: HW.orangeDark, width: 5 });
        ellipseGroup(body, "midL", [-62, 25], [200, 260], [0.88, 0.37, 0.06], { stroke: HW.orangeDark, width: 5 });
        ellipseGroup(body, "midR", [62, 25], [200, 260], [0.88, 0.37, 0.06], { stroke: HW.orangeDark, width: 5 });
        ellipseGroup(body, "outerL", [-120, 30], [170, 230], HW.orangeDark);
        ellipseGroup(body, "outerR", [120, 30], [170, 230], HW.orangeDark);
        var face = pc.layers.addShape();
        face.name = "face";
        pathGroup(face, "eyeL", [[-100, -10], [-40, -10], [-72, -70]], { fill: HW.face });
        pathGroup(face, "eyeR", [[40, -10], [100, -10], [72, -70]], { fill: HW.face });
        pathGroup(face, "nose", [[-16, 28], [16, 28], [0, 2]], { fill: HW.face });
        pathGroup(face, "mouth", [[-120, 55], [-88, 72], [-64, 58], [-42, 82], [-16, 64], [0, 88], [16, 64], [42, 82], [64, 58],
            [88, 72], [120, 55], [96, 108], [44, 130], [0, 136], [-44, 130], [-96, 108]], { fill: HW.face });
        glowFx(face, 35, 1.4);
        tr(face).property("ADBE Opacity").expression = FLICKER;
        return pc;
    }

    function hwTomb(comp, cross) {
        var name = cross ? "HW_CROSS" : "HW_TOMB";
        var pc = findComp(name);
        if (pc) return pc;
        pc = propComp(comp, name, 320, 460);
        var s = pc.layers.addShape();
        s.name = "stone";
        if (cross) {
            rectGroup(s, "v", [0, 20], [64, 420], HW.stone, { stroke: HW.stoneDark, width: 6 });
            rectGroup(s, "h", [0, -90], [250, 64], HW.stone, { stroke: HW.stoneDark, width: 6 });
        } else {
            // 手前から: ひび → 継ぎ目隠し → 下の四角 → 丸い上部
            pathGroup(s, "crack", [[-80, 70], [-58, 115], [-86, 155], [-64, 200]], { stroke: HW.stoneDark, width: 5, open: true });
            rectGroup(s, "fill", [0, 110], [238, 230], HW.stone);
            rectGroup(s, "base", [0, 120], [250, 220], HW.stone, { stroke: HW.stoneDark, width: 6 });
            rectGroup(s, "top", [0, 10], [250, 420], HW.stone, { round: 125, stroke: HW.stoneDark, width: 6 });
            var t = pc.layers.addText("R.I.P");
            var tp = t.property("ADBE Text Properties").property("ADBE Text Document");
            var td = tp.value;
            td.fontSize = 64;
            td.fillColor = HW.stoneDark;
            td.applyStroke = false;
            td.justification = ParagraphJustification.CENTER_JUSTIFY;
            tp.setValue(td);
            tr(t).property("ADBE Position").setValue([160, 190]);
        }
        // 下の方を苔っぽく暗く
        var moss = pc.layers.addSolid([0.08, 0.1, 0.06], "moss", 320, 460, 1, pc.duration);
        var r = addFx(moss, "ADBE Ramp");
        setFx(r, "ADBE Ramp-0001", 1, [160, 250]);
        setFx(r, "ADBE Ramp-0002", 2, [0, 0, 0, 1]);
        setFx(r, "ADBE Ramp-0003", 3, [160, 460]);
        setFx(r, "ADBE Ramp-0004", 4, [1, 1, 1, 1]);
        moss.blendingMode = BlendingMode.MULTIPLY;
        moss.preserveTransparency = true;
        tr(moss).property("ADBE Opacity").setValue(60);
        return pc;
    }

    function hwTree(comp) {
        var pc = findComp("HW_TREE");
        if (pc) return pc;
        pc = propComp(comp, "HW_TREE", 1400, 1400);
        var s = pc.layers.addShape();
        s.name = "tree";
        var rng = new Rng(666);
        var count = 0;
        function branch(x, y, ang, len, width, depth) {
            var rad = ang * Math.PI / 180;
            var x2 = x + Math.cos(rad) * len, y2 = y + Math.sin(rad) * len;
            var mx = (x + x2) / 2 + rng.range(-len, len) * 0.12, my = (y + y2) / 2 + rng.range(-len, len) * 0.12;
            pathGroup(s, "b" + (count++), [[x, y], [mx, my], [x2, y2]], { stroke: HW.ink, width: width, open: true });
            if (depth <= 0) return;
            var kids = depth > 3 ? 2 : (rng.next() < 0.5 ? 2 : 3);
            for (var i = 0; i < kids; i++) {
                // 左右に広がりつつ、全体としては上向きに戻す（傾きすぎ防止）
                var a2 = ang + (i - (kids - 1) / 2) * 52 + rng.range(-18, 18);
                a2 += (-90 - a2) * 0.1;
                branch(x2, y2, a2, len * rng.range(0.7, 0.82), Math.max(3, width * 0.6), depth - 1);
            }
        }
        branch(0, 700, -90, 360, 70, 5);
        // 根元
        pathGroup(s, "roots", [[-110, 700], [-30, 620], [30, 620], [120, 700]], { fill: HW.ink });
        return pc;
    }

    function hwMansion(comp) {
        var pc = findComp("HW_MANSION");
        if (pc) return pc;
        pc = propComp(comp, "HW_MANSION", 2000, 1300);
        var s = pc.layers.addShape();
        s.name = "silhouette";
        var c = HW.ink;
        pathGroup(s, "hill", [[-1000, 650], [-700, 420], [-300, 360], [300, 360], [700, 430], [1000, 650]], { fill: c });
        rectGroup(s, "main", [0, 180], [1100, 420], c);
        rectGroup(s, "wingL", [-470, 240], [360, 300], c);
        rectGroup(s, "wingR", [470, 240], [360, 300], c);
        rectGroup(s, "towerC", [0, -120], [300, 620], c);
        pathGroup(s, "roofC", [[-190, -420], [190, -420], [0, -640]], { fill: c });
        rectGroup(s, "towerL", [-620, 20], [200, 520], c);
        pathGroup(s, "roofL", [[-740, -230], [-500, -230], [-620, -420]], { fill: c });
        rectGroup(s, "towerR", [620, 20], [200, 520], c);
        pathGroup(s, "roofR", [[500, -230], [740, -230], [620, -420]], { fill: c });
        rectGroup(s, "chimney", [300, -40], [60, 200], c);
        var win = pc.layers.addShape();
        win.name = "windows";
        var rng = new Rng(13);
        var spots = [[-380, 120], [-240, 120], [-100, 120], [100, 120], [240, 120], [380, 120], [-380, 260], [380, 260],
                     [0, -200], [0, -40], [-620, -60], [620, -60], [-620, 90], [620, 90], [-470, 240], [470, 240]];
        for (var i = 0; i < spots.length; i++) {
            if (rng.next() < 0.3) continue; // いくつかは真っ暗
            rectGroup(win, "w" + i, spots[i], [54, 84], rng.next() < 0.7 ? HW.face : [1, 0.55, 0.2], { round: 18 });
        }
        glowFx(win, 30, 1.2);
        tr(win).property("ADBE Opacity").expression = FLICKER;
        return pc;
    }

    function hwMoon(comp) {
        var pc = findComp("HW_MOON");
        if (pc) return pc;
        pc = propComp(comp, "HW_MOON", 800, 800);
        var s = pc.layers.addShape();
        s.name = "moon";
        ellipseGroup(s, "c1", [-120, -90], [130, 110], [0.85, 0.72, 0.45], { opacity: 45 });
        ellipseGroup(s, "c2", [110, 60], [170, 150], [0.85, 0.72, 0.45], { opacity: 35 });
        ellipseGroup(s, "c3", [-40, 170], [90, 80], [0.85, 0.72, 0.45], { opacity: 40 });
        ellipseGroup(s, "disc", [0, 0], [600, 600], HW.moon);
        glowFx(s, 180, 0.9);
        return pc;
    }

    function hwBat(comp) {
        var pc = findComp("HW_BAT");
        if (pc) return pc;
        pc = propComp(comp, "HW_BAT", 280, 140);
        var s = pc.layers.addShape();
        s.name = "bat";
        var wl = [[0, 0], [-40, -34], [-120, -46], [-104, -12], [-88, 2], [-66, -6], [-50, 14], [-24, 6]];
        var wr = [];
        for (var i = 0; i < wl.length; i++) wr.push([-wl[i][0], wl[i][1]]);
        ellipseGroup(s, "eyeL", [-6, -4], [5, 5], [1, 0.2, 0.1]);
        ellipseGroup(s, "eyeR", [6, -4], [5, 5], [1, 0.2, 0.1]);
        pathGroup(s, "ears", [[-14, -12], [-10, -30], [-4, -16], [4, -16], [10, -30], [14, -12]], { fill: HW.ink });
        ellipseGroup(s, "body", [0, 6], [34, 48], HW.ink);
        var giL = pathGroup(s, "wingL", wl, { fill: HW.ink });
        var giR = pathGroup(s, "wingR", wr, { fill: HW.ink });
        var flap = '[value[0], value[1] * (0.2 + 0.8 * Math.abs(Math.sin(time * 15)))]';
        s.property("ADBE Root Vectors Group").property(giL).property("ADBE Vector Transform Group").property("ADBE Vector Scale").expression = flap;
        s.property("ADBE Root Vectors Group").property(giR).property("ADBE Vector Transform Group").property("ADBE Vector Scale").expression = flap;
        return pc;
    }

    function hwGhost(comp) {
        var pc = findComp("HW_GHOST");
        if (pc) return pc;
        pc = propComp(comp, "HW_GHOST", 300, 360);
        var s = pc.layers.addShape();
        s.name = "ghost";
        ellipseGroup(s, "eyeL", [-36, -36], [28, 40], HW.ink);
        ellipseGroup(s, "eyeR", [36, -36], [28, 40], HW.ink);
        ellipseGroup(s, "mouth", [0, 18], [34, 44], HW.ink);
        pathGroup(s, "body",
            [[-100, -30], [0, -140], [100, -30], [104, 130], [68, 100], [34, 140], [0, 104], [-34, 140], [-68, 100], [-104, 130]],
            { fill: HW.ghost, fillOpacity: 88,
              inT: [[0, 60], [-60, 0], [0, -60], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]],
              outT: [[0, -60], [60, 0], [0, 60], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0], [0, 0]] });
        glowFx(s, 40, 0.7);
        return pc;
    }

    function hwCandle(comp) {
        var pc = findComp("HW_CANDLE");
        if (pc) return pc;
        pc = propComp(comp, "HW_CANDLE", 100, 300);
        var s = pc.layers.addShape();
        s.name = "candle";
        rectGroup(s, "wick", [0, -32], [4, 18], [0.15, 0.1, 0.08]);
        pathGroup(s, "drip", [[-22, -25], [-8, -25], [-10, 10], [-16, 22], [-22, 10]], { fill: [0.97, 0.94, 0.86] });
        rectGroup(s, "wax", [0, 60], [44, 170], [0.93, 0.89, 0.78]);
        var f = pc.layers.addShape();
        f.name = "flame";
        ellipseGroup(f, "outer", [0, -60], [28, 60], [1, 0.62, 0.15]);
        ellipseGroup(f, "inner", [0, -54], [13, 28], [1, 0.96, 0.7]);
        tr(f).property("ADBE Anchor Point").setValue([0, -30]);
        tr(f).property("ADBE Position").setValue([50, 120]);
        tr(f).property("ADBE Scale").expression = '[value[0] * (0.9 + 0.12 * noise(time * 9)), value[1] * (0.85 + 0.25 * noise(time * 7 + 3))]';
        tr(f).property("ADBE Rotate Z").expression = 'noise(time * 5 + 9) * 8';
        glowFx(f, 40, 1.6);
        return pc;
    }

    function hwWall(comp) {
        var pc = findComp("HW_WALL");
        if (pc) return pc;
        pc = propComp(comp, "HW_WALL", 1200, 1400);
        pc.layers.addSolid([0.12, 0.05, 0.14], "paper", 1200, 1400, 1, pc.duration);
        var s = pc.layers.addShape();
        s.name = "stripes";
        var gi = shapeGroup(s, "stripes");
        vecs(s, gi).addProperty("ADBE Vector Shape - Rect");
        vecs(s, gi).addProperty("ADBE Vector Graphic - Fill");
        vecs(s, gi).addProperty("ADBE Vector Filter - Repeater");
        var v = vecs(s, gi);
        v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([26, 1400]);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba([0.18, 0.08, 0.2]));
        v.property("ADBE Vector Filter - Repeater").property("ADBE Vector Repeater Copies").setValue(14);
        v.property("ADBE Vector Filter - Repeater").property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([90, 0]);
        s.property("ADBE Root Vectors Group").property(gi).property("ADBE Vector Transform Group").property("ADBE Vector Position").setValue([-585, 0]);
        var d = pc.layers.addShape();
        d.name = "decor";
        ellipseGroup(d, "eyeL", [-24, -190], [14, 8], [1, 0.3, 0.2]);
        ellipseGroup(d, "eyeR", [24, -190], [14, 8], [1, 0.3, 0.2]);
        pathGroup(d, "portrait", [[-70, -40], [-60, -180], [0, -250], [60, -180], [70, -40], [120, 20], [-120, 20]],
            { fill: [0.16, 0.1, 0.18] });
        rectGroup(d, "frame", [0, -160], [380, 480], [0.04, 0.02, 0.05], { stroke: [0.55, 0.42, 0.16], width: 22 });
        rectGroup(d, "rail", [0, 318], [1200, 20], [0.42, 0.3, 0.12]);
        rectGroup(d, "wainscot", [0, 510], [1200, 380], [0.07, 0.03, 0.08]);
        return pc;
    }

    // 小物を3D空間に置く（足元基準・カメラの方を向く・Z方向に無限リサイクル）
    function placeProp(comp, item, name, pos, scale, o) {
        var L = comp.layers.add(item, comp.duration);
        L.name = PREFIX + name;
        L.threeDLayer = true;
        var ay = (o && o.top) ? 0 : (o && o.center ? item.height / 2 : item.height);
        tr(L).property("ADBE Anchor Point").setValue([item.width / 2, ay, 0]);
        tr(L).property("ADBE Position").setValue(pos);
        tr(L).property("ADBE Scale").setValue([scale, scale, 100]);
        if (!o || o.billboard !== false) L.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
        if (o && o.recycleLen) tr(L).property("ADBE Position").expression = exprRecycleZ(o.recycleLen, o.lead || 1500, false, 0, null);
        if (o && o.fadeLen) tr(L).property("ADBE Opacity").expression = exprFadeByDistance(1, o.fadeLen * 0.6, o.fadeLen * 0.95);
        return L;
    }

    // どこへ飛んでも同じ場所に見える空の飾り（月・洋館）
    function skyProp(comp, item, name, offset, scale) {
        var L = comp.layers.add(item, comp.duration);
        L.name = PREFIX + name;
        L.threeDLayer = true;
        tr(L).property("ADBE Position").setValue(offset);
        tr(L).property("ADBE Position").expression = 'try { add(value, thisComp.activeCamera.toWorld([0, 0, 0])); } catch (err) { value; }';
        tr(L).property("ADBE Scale").setValue([scale, scale, 100]);
        return L;
    }

    function hwGround(comp, base, floorY, color) {
        var g = comp.layers.addSolid(color, PREFIX + "HW_GROUND", 14000, 14000, 1, comp.duration);
        g.threeDLayer = true;
        tr(g).property("ADBE Rotate X").setValue(90);
        tr(g).property("ADBE Position").setValue([base[0], floorY, base[2]]);
        tr(g).property("ADBE Position").expression = [
            'try {',
            '  var p = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  [p[0], value[1], p[2] + 4000];',
            '} catch (err) { value; }'
        ].join("\n");
        return g;
    }

    function hwFog(comp, base, floorY, n, len, rng) {
        var made = [];
        for (var i = 0; i < n; i++) {
            var f = comp.layers.addSolid([1, 1, 1], PREFIX + "HW_FOG_" + (i + 1), 3000, 3000, 1, comp.duration);
            f.threeDLayer = true;
            addFx(f, "ADBE Fractal Noise");
            var tint = addFx(f, "ADBE Tint");
            setFx(tint, "ADBE Tint-0002", 2, rgba(HW.purple));
            ellipseMask(f, 1500, 1500, 2900, 2900, 1100);
            f.blendingMode = BlendingMode.SCREEN;
            tr(f).property("ADBE Rotate X").setValue(90);
            tr(f).property("ADBE Scale").setValue([220, 220, 100]);
            tr(f).property("ADBE Position").setValue([base[0] + rng.range(-2500, 2500), floorY - rng.range(40, 160), base[2] + i * (len / n)]);
            tr(f).property("ADBE Position").expression = exprRecycleZ(len, 2000, false, 0, null);
            tr(f).property("ADBE Opacity").setValue(rng.range(30, 50));
            made.push(f);
        }
        return made;
    }

    // =====================================================================
    // ハロウィン: 空間
    // =====================================================================
    function buildGraveyard(comp, o) {
        var base = sceneBase(comp);
        var floorY = base[1] + 700;
        var rng = new Rng(Math.floor(comp.time * 1000) + 31);
        var perSide = Math.max(4, Math.round(o.count / 2));
        var spacing = 650, len = perSide * spacing;
        var tomb = hwTomb(comp, false), cross = hwTomb(comp, true), pump = hwPumpkin(comp), tree = hwTree(comp);
        var made = [hwGround(comp, base, floorY, [0.05, 0.03, 0.06])];
        for (var side = -1; side <= 1; side += 2) {
            for (var i = 0; i < perSide; i++) {
                var z = base[2] + i * spacing + rng.range(-200, 200);
                var r = rng.next(), item, x, sc, nm;
                if (r < 0.45) { item = tomb; nm = "TOMB"; x = rng.range(450, 1500); sc = rng.range(70, 110); }
                else if (r < 0.65) { item = cross; nm = "CROSS"; x = rng.range(450, 1600); sc = rng.range(70, 110); }
                else if (r < 0.85) { item = pump; nm = "PUMPKIN"; x = rng.range(350, 900); sc = rng.range(45, 80); }
                else { item = tree; nm = "TREE"; x = rng.range(1600, 2800); sc = rng.range(120, 200); }
                made.push(placeProp(comp, item, "GRAVE_" + nm + "_" + (side < 0 ? "L" : "R") + (i + 1),
                    [base[0] + side * x, floorY, z], sc, { recycleLen: len, fadeLen: len }));
            }
        }
        made = made.concat(hwFog(comp, base, floorY, 6, len, rng));
        made.push(skyProp(comp, hwMoon(comp), "HW_MOON", [2200, -2300, 9000], 260));
        made.push(skyProp(comp, hwMansion(comp), "HW_MANSION", [-1500, -300, 9500], 420));
        return finish(comp, made, 11);
    }

    function buildCorridor(comp, o) {
        var base = sceneBase(comp);
        var floorY = base[1] + 700;
        var n = Math.max(4, o.count);
        var S = 1200, len = n * S, half = 950, wallH = 1400;
        var wall = hwWall(comp), candle = hwCandle(comp);
        var made = [];
        for (var i = 0; i < n; i++) {
            var z = base[2] + i * S;
            for (var side = -1; side <= 1; side += 2) {
                var w = comp.layers.add(wall, comp.duration);
                w.name = PREFIX + "HALL_WALL_" + (side < 0 ? "L" : "R") + (i + 1);
                w.threeDLayer = true;
                tr(w).property("ADBE Position").setValue([base[0] + side * half, floorY - wallH / 2, z]);
                tr(w).property("ADBE Rotate Y").setValue(90);
                tr(w).property("ADBE Position").expression = exprRecycleZ(len, S * 1.5, false, 0, null);
                tr(w).property("ADBE Opacity").expression = exprFadeByDistance(1, len * 0.45, len * 0.85);
                made.push(w);
                made.push(placeProp(comp, candle, "HALL_CANDLE_" + (side < 0 ? "L" : "R") + (i + 1),
                    [base[0] + side * (half - 80), floorY - 560, z + S / 2], 110, { recycleLen: len, lead: S * 1.5, fadeLen: len * 0.9 }));
            }
        }
        var planes = [["HALL_FLOOR", [0.2, 0.03, 0.06], floorY], ["HALL_CEILING", [0.03, 0.01, 0.04], floorY - wallH]];
        for (var k = 0; k < planes.length; k++) {
            var p = comp.layers.addSolid(planes[k][1], PREFIX + planes[k][0], half * 2, len, 1, comp.duration);
            p.threeDLayer = true;
            tr(p).property("ADBE Rotate X").setValue(90);
            tr(p).property("ADBE Position").setValue([base[0], planes[k][2], base[2] + len / 2]);
            tr(p).property("ADBE Position").expression = [
                'try {',
                '  var p = thisComp.activeCamera.toWorld([0, 0, 0]);',
                '  [value[0], value[1], Math.round(p[2] / ' + S + ') * ' + S + ' + ' + (len / 2 - S) + '];',
                '} catch (err) { value; }'
            ].join("\n");
            made.push(p);
        }
        // 奥の闇
        var dark = comp.layers.addSolid([0, 0, 0], PREFIX + "HALL_DARKNESS", half * 2, wallH, 1, comp.duration);
        dark.threeDLayer = true;
        tr(dark).property("ADBE Position").setValue([base[0], floorY - wallH / 2, 0]);
        tr(dark).property("ADBE Position").expression = 'try { [value[0], value[1], thisComp.activeCamera.toWorld([0, 0, 0])[2] + ' + (len * 0.85) + ']; } catch (err) { value; }';
        made.push(dark);
        return finish(comp, made, 11);
    }

    function buildPumpkinField(comp, o) {
        var base = sceneBase(comp);
        var floorY = base[1] + 700;
        var rng = new Rng(Math.floor(comp.time * 1000) + 71);
        var n = Math.max(6, o.count);
        var spacing = 420, len = Math.ceil(n / 2) * spacing;
        var pump = hwPumpkin(comp), tree = hwTree(comp);
        var made = [hwGround(comp, base, floorY, [0.06, 0.04, 0.03])];
        for (var i = 0; i < n; i++) {
            var side = i % 2 === 0 ? -1 : 1;
            var floating = rng.next() < 0.25;
            var y = floating ? floorY - rng.range(500, 1300) : floorY;
            var L = placeProp(comp, pump, "FIELD_PUMPKIN_" + (i + 1),
                [base[0] + side * rng.range(350, 2200), y, base[2] + Math.floor(i / 2) * spacing + rng.range(-150, 150)],
                rng.range(40, 95), { recycleLen: len, fadeLen: len });
            if (floating) {
                tr(L).property("ADBE Position").expression = [
                    'seedRandom(index, true);',
                    'var v = add(value, [0, Math.sin(time * random(0.6, 1.2) + random(6.28)) * 40, 0]);',
                    'try {',
                    '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
                    '  var Ln = ' + f3(len) + ', lead = 1500, d = v[2] - cp[2] + lead;',
                    '  d = ((d % Ln) + Ln) % Ln;',
                    '  [v[0], v[1], cp[2] + d - lead];',
                    '} catch (err) { v; }'
                ].join("\n");
            }
            made.push(L);
        }
        for (i = 0; i < 6; i++) {
            var sd = i % 2 === 0 ? -1 : 1;
            made.push(placeProp(comp, tree, "FIELD_TREE_" + (i + 1),
                [base[0] + sd * rng.range(2600, 3400), floorY, base[2] + i * (len / 6)], rng.range(150, 220), { recycleLen: len, fadeLen: len }));
        }
        made = made.concat(hwFog(comp, base, floorY, 4, len, rng));
        made.push(skyProp(comp, hwMoon(comp), "HW_MOON", [-2000, -2400, 9000], 300));
        made.push(skyProp(comp, hwMansion(comp), "HW_MANSION", [1800, -350, 9500], 380));
        return finish(comp, made, 11);
    }

    // コウモリ（横切って飛ぶ）＋おばけ（ふわふわ・すけすけ）
    function buildCreatures(comp, o) {
        var rng = new Rng(Math.floor(comp.time * 1000) + 97);
        var n = Math.max(4, o.count);
        var bat = hwBat(comp), ghost = hwGhost(comp);
        var box = [7000, 3000, 7000], ahead = 2500;
        var made = [];
        for (var i = 0; i < n; i++) {
            var isGhost = i % 4 === 3;
            var L = comp.layers.add(isGhost ? ghost : bat, comp.duration + 10);
            L.name = PREFIX + (isGhost ? "GHOST_" : "BAT_") + (i + 1);
            L.startTime = -rng.range(0, 5); // 羽ばたきのタイミングをずらす
            L.threeDLayer = true;
            L.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
            tr(L).property("ADBE Position").setValue([rng.range(-box[0] / 2, box[0] / 2), rng.range(-box[1] / 2, box[1] / 2) - 300, rng.range(-box[2] / 2, box[2] / 2)]);
            var vx = isGhost ? 'random(-60, 60)' : '(random() < 0.5 ? -1 : 1) * random(350, 800)';
            tr(L).property("ADBE Position").expression = [
                'seedRandom(index, true);',
                'var vx = ' + vx + ', vy = random(-40, 40), fr = random(0.5, 1.4), ph = random(6.28);',
                'var bob = ' + (isGhost ? '70' : '35') + ';',
                'var p = add(value, [time * vx, time * vy + Math.sin(time * fr * 3 + ph) * bob, Math.cos(time * fr + ph) * 120]);',
                'try {',
                '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
                '  var B = ' + arr(box) + ', off = [0, -300, ' + ahead + '], r = [];',
                '  for (var i = 0; i < 3; i++) {',
                '    var d = p[i] - cp[i] - off[i] + B[i] / 2;',
                '    d = ((d % B[i]) + B[i]) % B[i];',
                '    r.push(cp[i] + off[i] + d - B[i] / 2);',
                '  }',
                '  r;',
                '} catch (err) { p; }'
            ].join("\n");
            var sc = isGhost ? rng.range(60, 120) : rng.range(35, 80);
            tr(L).property("ADBE Scale").setValue([sc, sc, 100]);
            if (isGhost) {
                tr(L).property("ADBE Opacity").expression = 'seedRandom(index, true);\nvalue * (0.35 + 0.45 * (0.5 + 0.5 * Math.sin(time * random(0.8, 1.6) + random(6.28))))';
                tr(L).property("ADBE Rotate Z").expression = 'seedRandom(index, true);\nMath.sin(time * random(1, 2)) * 10';
            }
            made.push(L);
        }
        return finish(comp, made, 11);
    }

    // 紫×オレンジのハロウィン色調
    function buildHalloweenGrade(comp) {
        var adj = comp.layers.addSolid([1, 1, 1], PREFIX + "HW_GRADE", comp.width, comp.height, 1, comp.duration);
        adj.adjustmentLayer = true;
        var tt = addFx(adj, "ADBE Tritone");
        setFx(tt, "ADBE Tritone-0001", 1, [1, 0.72, 0.4, 1]);
        setFx(tt, "ADBE Tritone-0002", 2, [0.42, 0.18, 0.55, 1]);
        setFx(tt, "ADBE Tritone-0003", 3, [0.03, 0.01, 0.06, 1]);
        setFx(tt, "ADBE Tritone-0004", 4, 55);
        glowFx(adj, 60, 0.6);
        var vig = comp.layers.addSolid([0.05, 0, 0.08], PREFIX + "HW_VIGNETTE", comp.width, comp.height, 1, comp.duration);
        var m = ellipseMask(vig, comp.width / 2, comp.height / 2, comp.width * 1.1, comp.height * 1.3, comp.width * 0.35);
        m.inverted = true;
        tr(vig).property("ADBE Opacity").setValue(75);
        vig.moveToBeginning();
        adj.moveToBeginning();
        LAST_MADE.push(adj);
        LAST_MADE.push(vig);
        var ctrl = findLayer(comp, "MV_CONTROL") || findLayer(comp, "CAM_CONTROL");
        if (ctrl) ctrl.moveToBeginning();
        return "ハロウィン色調（紫×オレンジ）とビネットを一番上に追加しました。強さは STG_HW_GRADE の Tritone「元の画像とブレンド」で調整できます。";
    }

    // =====================================================================
    // 仮面舞踏会: 小物
    // =====================================================================
    var MQ = {
        gold: [0.86, 0.68, 0.28], goldDark: [0.5, 0.36, 0.1], marble: [0.88, 0.85, 0.79], marbleDark: [0.7, 0.66, 0.6],
        crimson: [0.56, 0.04, 0.1], crimsonDark: [0.32, 0.01, 0.06], wax: [0.95, 0.91, 0.8], flame: [1, 0.66, 0.2],
        crystal: [0.85, 0.95, 1], silhouette: [0.04, 0.02, 0.06]
    };

    function groupXform(sl, gi) {
        return sl.property("ADBE Root Vectors Group").property(gi).property("ADBE Vector Transform Group");
    }

    function mqPillar(comp) {
        var pc = findComp("MQ_PILLAR");
        if (pc) return pc;
        pc = propComp(comp, "MQ_PILLAR", 420, 1700);
        var s = pc.layers.addShape();
        s.name = "pillar";
        // 手前から: 柱頭の渦巻き → 柱頭・柱礎 → 溝 → 柱身
        ellipseGroup(s, "scrollL", [-138, -742], [64, 64], MQ.gold, { stroke: MQ.goldDark, width: 5 });
        ellipseGroup(s, "scrollR", [138, -742], [64, 64], MQ.gold, { stroke: MQ.goldDark, width: 5 });
        rectGroup(s, "capTop", [0, -770], [330, 50], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        rectGroup(s, "capNeck", [0, -720], [270, 44], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        rectGroup(s, "baseTop", [0, 725], [270, 44], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        rectGroup(s, "baseBottom", [0, 780], [340, 70], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        var gi = shapeGroup(s, "flutes");
        vecs(s, gi).addProperty("ADBE Vector Shape - Rect");
        vecs(s, gi).addProperty("ADBE Vector Graphic - Fill");
        vecs(s, gi).addProperty("ADBE Vector Filter - Repeater");
        var v = vecs(s, gi);
        v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([10, 1360]);
        v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(MQ.marbleDark));
        v.property("ADBE Vector Filter - Repeater").property("ADBE Vector Repeater Copies").setValue(6);
        v.property("ADBE Vector Filter - Repeater").property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([36, 0]);
        groupXform(s, gi).property("ADBE Vector Position").setValue([-90, 0]);
        rectGroup(s, "shaft", [0, 0], [230, 1420], MQ.marble);
        return pc;
    }

    function mqChandelier(comp) {
        var pc = findComp("MQ_CHANDELIER");
        if (pc) return pc;
        pc = propComp(comp, "MQ_CHANDELIER", 1000, 900);
        // 炎（手前のレイヤー・光る・ゆらめく）
        var tips = [[-360, 60], [-200, 90], [200, 90], [360, 60], [-250, -60], [-90, -40], [90, -40], [250, -60]];
        var s = pc.layers.addShape();
        s.name = "frame";
        var fl = pc.layers.addShape(); // 後から作ったレイヤーが上＝炎が手前
        fl.name = "flames";
        var i;
        for (i = 0; i < tips.length; i++) {
            ellipseGroup(fl, "f" + i, [tips[i][0], tips[i][1] - 62], [16, 34], MQ.flame);
        }
        glowFx(fl, 45, 1.8);
        tr(fl).property("ADBE Opacity").expression = FLICKER;
        // 本体（手前から: ろうそく → クリスタル → 腕 → 胴体 → 鎖）
        for (i = 0; i < tips.length; i++) {
            rectGroup(s, "c" + i, [tips[i][0], tips[i][1] - 24], [16, 48], MQ.wax);
            rectGroup(s, "cup" + i, [tips[i][0], tips[i][1] + 2], [44, 12], MQ.gold);
        }
        var drops = [[-300, 140], [-150, 170], [0, 250], [150, 170], [300, 140], [-230, 30], [230, 30], [-75, 60], [75, 60], [0, 150]];
        for (i = 0; i < drops.length; i++) {
            ellipseGroup(s, "d" + i, drops[i], [12, 28], MQ.crystal, { opacity: 85 });
            rectGroup(s, "dl" + i, [drops[i][0], drops[i][1] - 30], [2, 34], MQ.crystal);
        }
        for (i = 0; i < tips.length; i++) {
            var tx = tips[i][0], ty = tips[i][1];
            // 胴体の下から外へ垂れ下がり、先端でろうそくへ跳ね上がるS字の腕
            var mx = tx * 0.6, my = ty + (ty > 0 ? 120 : 150);
            pathGroup(s, "arm" + i, [[0, 30], [mx, my], [tx, ty]], {
                stroke: MQ.gold, width: 11, open: true,
                inT: [[0, 0], [-tx * 0.3, 0], [0, 50]],
                outT: [[tx * 0.15, 40], [tx * 0.3, 0], [0, 0]] });
        }
        ellipseGroup(s, "ring", [0, 60], [520, 90], MQ.gold, { opacity: 0, stroke: MQ.gold, width: 7 });
        pathGroup(s, "bowl", [[-110, 20], [110, 20], [60, 110], [0, 140], [-60, 110]], { fill: MQ.gold, stroke: MQ.goldDark, width: 4 });
        ellipseGroup(s, "body", [0, -60], [110, 170], MQ.gold, { stroke: MQ.goldDark, width: 5 });
        rectGroup(s, "chain", [0, -300], [12, 320], MQ.goldDark);
        glowFx(s, 20, 0.5);
        return pc;
    }

    function mqCurtain(comp) {
        var pc = findComp("MQ_CURTAIN");
        if (pc) return pc;
        pc = propComp(comp, "MQ_CURTAIN", 800, 1600);
        var s = pc.layers.addShape();
        s.name = "curtain";
        // 手前から: タッセル → 上飾り（スカラップ） → ひだ
        ellipseGroup(s, "tieL", [-300, 150], [70, 50], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        ellipseGroup(s, "tieR", [300, 150], [70, 50], MQ.gold, { stroke: MQ.goldDark, width: 4 });
        rectGroup(s, "rod", [0, -770], [800, 24], MQ.gold);
        for (var i = 0; i < 5; i++) {
            ellipseGroup(s, "scallop" + i, [-320 + i * 160, -700], [170, 120], MQ.crimson, { stroke: MQ.gold, width: 8 });
        }
        rectGroup(s, "valance", [0, -730], [800, 60], MQ.crimson);
        // 左右に寄せたカーテン（タッセルで絞った形）。手前のひだから作る
        var sides = [-1, 1];
        for (var k = 0; k < 2; k++) {
            var sd = sides[k];
            for (var f = 2; f >= 0; f--) {
                var inTop = sd * (400 - 260 + f * 70), inTie = sd * (330 + f * 15), inBot = sd * (400 - 220 + f * 60);
                var col = f % 2 === 0 ? MQ.crimson : MQ.crimsonDark;
                pathGroup(s, "fold" + k + f, [[sd * 400, -760], [inTop, -760], [inTie, 150], [inBot, 800], [sd * 400, 800]], {
                    fill: col,
                    inT: [[0, 0], [0, 0], [sd * -40, -300], [0, -250], [0, 0]],
                    outT: [[0, 0], [0, 300], [sd * -40, 250], [0, 0], [0, 0]] });
            }
        }
        return pc;
    }

    function mqMask(comp) {
        var pc = findComp("MQ_MASK");
        if (pc) return pc;
        pc = propComp(comp, "MQ_MASK", 700, 760);
        var s = pc.layers.addShape();
        s.name = "mask";
        // 手前から: 宝石 → 目の穴 → 金の飾り → 仮面 → 羽根
        ellipseGroup(s, "gem", [0, -30], [30, 38], [0.8, 0.05, 0.2], { stroke: MQ.gold, width: 5 });
        ellipseGroup(s, "eyeL", [-95, 30], [112, 58], [0.02, 0, 0.03], { stroke: MQ.gold, width: 6 });
        ellipseGroup(s, "eyeR", [95, 30], [112, 58], [0.02, 0, 0.03], { stroke: MQ.gold, width: 6 });
        pathGroup(s, "curlL", [[-160, -20], [-200, -50], [-230, -10], [-200, 10]], { stroke: MQ.gold, width: 5, open: true });
        pathGroup(s, "curlR", [[160, -20], [200, -50], [230, -10], [200, 10]], { stroke: MQ.gold, width: 5, open: true });
        pathGroup(s, "mask", [[-240, 0], [-160, -60], [-60, -40], [0, -10], [60, -40], [160, -60], [240, 0], [210, 70],
            [130, 110], [50, 80], [0, 100], [-50, 80], [-130, 110], [-210, 70]], { fill: [0.16, 0.04, 0.24], stroke: MQ.gold, width: 8 });
        var feathers = [[[-150, -40], [-210, -170], [-230, -300], [-170, -190], [-120, -60]],
                        [[-120, -50], [-140, -200], [-120, -330], [-95, -200], [-90, -60]],
                        [[-180, -30], [-280, -130], [-340, -240], [-250, -150], [-160, -20]]];
        var fc = [[0.45, 0.1, 0.6], [0.85, 0.2, 0.5], MQ.gold];
        for (var i = 0; i < feathers.length; i++) {
            pathGroup(s, "feather" + i, feathers[i], { fill: fc[i], stroke: MQ.goldDark, width: 3 });
        }
        glowFx(s, 15, 0.4);
        return pc;
    }

    function mqDancers(comp) {
        var pc = findComp("MQ_DANCERS");
        if (pc) return pc;
        pc = propComp(comp, "MQ_DANCERS", 700, 1000);
        var s = pc.layers.addShape();
        s.name = "dancers";
        var c = MQ.silhouette;
        // 小さな金の仮面（手前）
        rectGroup(s, "maskW", [55, -352], [58, 14], MQ.gold, { round: 7 });
        rectGroup(s, "maskM", [-70, -412], [62, 14], MQ.gold, { round: 7 });
        // 女性: 頭・胴・ドレス
        ellipseGroup(s, "headW", [55, -350], [66, 82], c);
        pathGroup(s, "hairW", [[20, -370], [55, -400], [95, -380], [100, -330], [80, -300]], { fill: c });
        pathGroup(s, "torsoW", [[30, -305], [85, -305], [90, -160], [25, -160]], { fill: c });
        pathGroup(s, "gown", [[25, -170], [95, -170], [260, 470], [120, 440], [0, 480], [-120, 450], [-150, 470]], { fill: c });
        // 男性: 頭・胴・脚・腕（女性の腰と手へ）
        ellipseGroup(s, "headM", [-70, -410], [70, 86], c);
        pathGroup(s, "torsoM", [[-120, -360], [-20, -360], [-10, -60], [-130, -60]], { fill: c });
        pathGroup(s, "legs", [[-130, -70], [-10, -70], [-20, 480], [-60, 480], [-70, 60], [-90, 480], [-130, 480]], { fill: c });
        // ワルツの組み方: 男性の右手は女性の背中、左手と女性の右手を横でつなぐ
        pathGroup(s, "armM", [[-30, -330], [30, -250], [60, -230]], { stroke: c, width: 30, open: true });
        pathGroup(s, "armHold", [[-120, -335], [-200, -330], [-215, -385]], { stroke: c, width: 24, open: true });
        pathGroup(s, "armW", [[35, -290], [-60, -300], [-190, -390]], { stroke: c, width: 20, open: true });
        return pc;
    }

    function mqFloor(comp, base, floorY) {
        var sq = 320;
        var n = 36;
        var bgc = comp.layers.addSolid([0.04, 0.02, 0.04], PREFIX + "MQ_FLOOR_BASE", sq * n, sq * n, 1, comp.duration);
        var sl = comp.layers.addShape();
        sl.name = PREFIX + "MQ_FLOOR_TILES";
        for (var k = 0; k < 2; k++) {
            var gi = shapeGroup(sl, "tiles" + k);
            vecs(sl, gi).addProperty("ADBE Vector Shape - Rect");
            vecs(sl, gi).addProperty("ADBE Vector Graphic - Fill");
            vecs(sl, gi).addProperty("ADBE Vector Filter - Repeater");
            vecs(sl, gi).addProperty("ADBE Vector Filter - Repeater");
            var v = vecs(sl, gi);
            v.property("ADBE Vector Shape - Rect").property("ADBE Vector Rect Size").setValue([sq, sq]);
            v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Color").setValue(rgba(MQ.marble));
            v.property("ADBE Vector Graphic - Fill").property("ADBE Vector Fill Opacity").setValue(80);
            v.property(3).property("ADBE Vector Repeater Copies").setValue(n / 2);
            v.property(3).property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([sq * 2, 0]);
            v.property(4).property("ADBE Vector Repeater Copies").setValue(n / 2);
            v.property(4).property("ADBE Vector Repeater Transform").property("ADBE Vector Repeater Position").setValue([0, sq * 2]);
            var off = -sq * n / 2 + sq / 2 + k * sq;
            groupXform(sl, gi).property("ADBE Vector Position").setValue([off, off]);
        }
        var follow = [
            'try {',
            '  var p = thisComp.activeCamera.toWorld([0, 0, 0]);',
            '  var st = ' + (sq * 2) + ';',
            '  [Math.round(p[0] / st) * st, value[1], Math.round(p[2] / st) * st + ' + (sq * n * 0.3) + '];',
            '} catch (err) { value; }'
        ].join("\n");
        var out = [bgc, sl];
        for (var i = 0; i < out.length; i++) {
            out[i].threeDLayer = true;
            tr(out[i]).property("ADBE Rotate X").setValue(90);
            tr(out[i]).property("ADBE Position").setValue([base[0], floorY - i, base[2]]);
            tr(out[i]).property("ADBE Position").expression = follow;
        }
        return out;
    }

    // =====================================================================
    // 仮面舞踏会: 会場
    // =====================================================================
    function buildMasquerade(comp, o) {
        var base = sceneBase(comp);
        var floorY = base[1] + 700;
        var rng = new Rng(Math.floor(comp.time * 1000) + 131);
        var n = Math.max(4, Math.round(o.count / 2));
        var spacing = 1100, len = n * spacing, half = 1500;
        var pillar = mqPillar(comp), curtain = mqCurtain(comp), chand = mqChandelier(comp), dancers = mqDancers(comp), mask = mqMask(comp);
        var made = mqFloor(comp, base, floorY);
        var rec = { recycleLen: len, lead: spacing * 1.5, fadeLen: len, billboard: false };
        for (var i = 0; i < n; i++) {
            var z = base[2] + i * spacing;
            for (var side = -1; side <= 1; side += 2) {
                var sname = side < 0 ? "L" : "R";
                made.push(placeProp(comp, pillar, "MQ_PILLAR_" + sname + (i + 1), [base[0] + side * half, floorY, z], 110, rec));
                var cu = placeProp(comp, curtain, "MQ_CURTAIN_" + sname + (i + 1), [base[0] + side * (half + 150), floorY, z + spacing / 2], 105, rec);
                tr(cu).property("ADBE Rotate Y").setValue(90);
                made.push(cu);
            }
            if (i % 2 === 0) {
                var ch = placeProp(comp, chand, "MQ_CHANDELIER_" + (i / 2 + 1), [base[0] + rng.range(-200, 200), floorY - 2500, z + spacing / 2], 120,
                    { recycleLen: len, lead: spacing * 1.5, fadeLen: len, top: true });
                tr(ch).property("ADBE Rotate Z").expression = 'seedRandom(index, true);\nMath.sin(time * random(0.4, 0.7) + random(6.28)) * 2.5';
                made.push(ch);
            }
        }
        // ワルツを踊るカップル（その場でくるくる回りながら小さな円を描く）
        var couples = Math.max(4, Math.round(n * 1.2));
        for (i = 0; i < couples; i++) {
            var sx = (i % 2 === 0 ? -1 : 1) * rng.range(250, 1100);
            var d = placeProp(comp, dancers, "MQ_DANCERS_" + (i + 1), [base[0] + sx, floorY, base[2] + (i / couples) * len], rng.range(85, 105), rec);
            tr(d).property("ADBE Rotate Y").expression = 'seedRandom(index, true);\nvalue + time * random(50, 80) * (random() < 0.5 ? -1 : 1)';
            tr(d).property("ADBE Position").expression = [
                'seedRandom(index, true);',
                'var r = random(60, 140), w = random(0.4, 0.7), ph = random(6.28);',
                'var v = add(value, [Math.cos(time * w + ph) * r, 0, Math.sin(time * w + ph) * r]);',
                'try {',
                '  var cp = thisComp.activeCamera.toWorld([0, 0, 0]);',
                '  var Ln = ' + f3(len) + ', lead = ' + f3(spacing * 1.5) + ', dd = v[2] - cp[2] + lead;',
                '  dd = ((dd % Ln) + Ln) % Ln;',
                '  [v[0], v[1], cp[2] + dd - lead];',
                '} catch (err) { v; }'
            ].join("\n");
            made.push(d);
        }
        // 宙に浮かぶ仮面（色違い）
        var masks = Math.max(4, Math.round(n * 1.5));
        var box = [4200, 2200, 6000];
        for (i = 0; i < masks; i++) {
            var m = comp.layers.add(mask, comp.duration);
            m.name = PREFIX + "MQ_MASK_" + (i + 1);
            m.threeDLayer = true;
            m.autoOrient = AutoOrientType.CAMERA_OR_POINT_OF_INTEREST;
            tr(m).property("ADBE Position").setValue([rng.range(-box[0] / 2, box[0] / 2), rng.range(-box[1] / 2, box[1] / 2), rng.range(-box[2] / 2, box[2] / 2)]);
            tr(m).property("ADBE Position").expression = exprRecycleBox(box, 2500, -15, 15, 90);
            var sc = rng.range(35, 70);
            tr(m).property("ADBE Scale").setValue([sc, sc, 100]);
            tr(m).property("ADBE Rotate Z").expression = 'seedRandom(index, true);\nMath.sin(time * random(0.5, 1) + random(6.28)) * 12';
            try {
                var hue = addFx(m, "ADBE Color Balance (HLS)", "Mask Color");
                setFx(hue, "ADBE Color Balance (HLS)-0001", 1, rng.range(-180, 180));
            } catch (e) {}
            made.push(m);
        }
        var count = finish(comp, made, 9);
        // 金の紙吹雪
        count += buildParticles(comp, { type: "neon", count: Math.max(40, n * 10), color: [1, 0.8, 0.35] });
        return count;
    }

    function buildMasqueradeGrade(comp) {
        var adj = comp.layers.addSolid([1, 1, 1], PREFIX + "MQ_GRADE", comp.width, comp.height, 1, comp.duration);
        adj.adjustmentLayer = true;
        var tt = addFx(adj, "ADBE Tritone");
        setFx(tt, "ADBE Tritone-0001", 1, [1, 0.88, 0.6, 1]);
        setFx(tt, "ADBE Tritone-0002", 2, [0.55, 0.1, 0.16, 1]);
        setFx(tt, "ADBE Tritone-0003", 3, [0.04, 0.01, 0.03, 1]);
        setFx(tt, "ADBE Tritone-0004", 4, 55);
        glowFx(adj, 80, 0.7);
        adj.moveToBeginning();
        var ctrl = findLayer(comp, "MV_CONTROL") || findLayer(comp, "CAM_CONTROL");
        if (ctrl) ctrl.moveToBeginning();
        LAST_MADE.push(adj);
        return "仮面舞踏会の色調（深紅×金）を一番上に追加しました。";
    }

    // =====================================================================
    // 表示区間（サビだけ／サビ以外／ワークエリアだけ）
    // =====================================================================
    var SECTIONS = [
        { key: "all", label: "全部の時間" },
        { key: "chorus", label: "サビ（歌詞の ! 行）だけ" },
        { key: "verse", label: "サビ以外" },
        { key: "work", label: "ワークエリアだけ" }
    ];

    // 歌詞ビルダーの強調行レイヤー LYRIC_###_! から区間を集めて、近いものはまとめる
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

    function sectionSlider(comp, name, ranges) {
        var host = findLayer(comp, PREFIX + "SECTIONS");
        if (!host) {
            host = comp.layers.addNull(comp.duration);
            host.name = PREFIX + "SECTIONS";
            host.label = 2;
        }
        var fxp = host.property("ADBE Effect Parade");
        var fx = fxp.property(name);
        if (!fx) {
            fx = fxp.addProperty("ADBE Slider Control");
            fx.name = name;
        }
        var p = host.property("ADBE Effect Parade").property(name).property(1);
        while (p.numKeys > 0) p.removeKey(1);
        var fade = 0.35;
        p.setValueAtTime(0, 0);
        for (var i = 0; i < ranges.length; i++) {
            var a = Math.max(0, ranges[i][0] - fade), b = ranges[i][1];
            p.setValueAtTime(a, 0);
            p.setValueAtTime(a + fade, 100);
            p.setValueAtTime(Math.max(a + fade + 0.01, b), 100);
            p.setValueAtTime(Math.max(a + fade + 0.02, b + fade), 0);
        }
        host.shy = true;
        return name;
    }

    function applySection(comp, layers, mode) {
        if (mode === "all" || !layers.length) return "";
        var name, ranges;
        if (mode === "work") {
            ranges = [[comp.workAreaStart, comp.workAreaStart + comp.workAreaDuration]];
            name = "Range " + ranges[0][0].toFixed(2) + "-" + ranges[0][1].toFixed(2);
        } else {
            ranges = chorusRanges(comp);
            if (!ranges.length) throw new Error("サビ（! 行）の歌詞レイヤー LYRIC_…_! が見つかりません。\n歌詞ビルダーで作ったコンポで実行するか、「ワークエリアだけ」を使ってください。");
            name = "Chorus";
        }
        sectionSlider(comp, name, ranges);
        var g = 'thisComp.layer("' + PREFIX + 'SECTIONS").effect("' + name + '")(1) / 100';
        if (mode === "verse") g = '(1 - ' + g + ')';
        for (var i = 0; i < layers.length; i++) {
            var L = layers[i];
            var op = tr(L).property("ADBE Opacity");
            if (L.adjustmentLayer || !op.expression) {
                op.expression = 'value * ' + g;
            } else {
                // 既にエクスプレッションがある不透明度は壊さず、Transform エフェクトの不透明度で切り替える
                var fx = addFx(L, "ADBE Geometry2", "Section Gate");
                exprFx(fx, "ADBE Geometry2-0009", 9, 'value * ' + g);
            }
        }
        var list = [];
        for (i = 0; i < ranges.length; i++) list.push(ranges[i][0].toFixed(1) + "〜" + ranges[i][1].toFixed(1) + "秒");
        return "\n表示区間: " + list.join(" / ") + (mode === "verse" ? " 以外" : "");
    }

    // =====================================================================
    // 削除
    // =====================================================================
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
    var KINDS = [
        { key: "tunnel", label: "ネオントンネル", count: 24, note: "奥へ飛ぶカメラと相性◎。形・回転・虹色を選べます。" },
        { key: "city", label: "ネオン都市", count: 16, note: "道路の両側にビルが並ぶ夜の街（個数 = ビルの数）。" },
        { key: "stage", label: "ライブステージ", count: 8, note: "LEDウォール＋スポットライト＋もや（個数 = ライトの数）。" },
        { key: "clouds", label: "雲海＋月", count: 10, note: "雲の上を飛ぶ空間（個数 = 雲の枚数）。" },
        { key: "particles", label: "パーティクル", count: 150, note: "桜・雪・光の粒。カメラの周りに常に舞います。" },
        { key: "pano", label: "パノラマ背景", count: 16, note: "横長の背景イラストを選択して実行（個数 = 分割数）。" },
        { key: "hw_grave", label: "【ハロウィン】ハロウィン墓地", count: 24, note: "墓石・十字架・枯れ木・カボチャ・紫の霧・月・丘の上の洋館（個数 = 小物の数）。" },
        { key: "hw_hall", label: "【ハロウィン】洋館の廊下", count: 8, note: "壁紙・肖像画・ろうそくの廊下。奥は闇に消える（個数 = 廊下の区画数）。" },
        { key: "hw_field", label: "【ハロウィン】カボチャ畑", count: 30, note: "光るカボチャが並び、いくつかは宙に浮かぶ。月と洋館付き（個数 = カボチャの数）。" },
        { key: "hw_creatures", label: "【ハロウィン】コウモリ＆おばけ", count: 24, note: "コウモリが横切り、おばけがふわふわ漂う（4体に1体がおばけ）。" },
        { key: "hw_grade", label: "【ハロウィン】色調", count: 1, note: "紫×オレンジの色調補正＋ビネットを一番上に追加。" },
        { key: "mq_ball", label: "【仮面舞踏会】会場", count: 12, note: "市松の大理石の床・金の柱・赤いカーテン・シャンデリア・踊るカップル・浮かぶ仮面・金の紙吹雪（個数 = 柱の数）。" },
        { key: "mq_grade", label: "【仮面舞踏会】色調", count: 1, note: "深紅×金の色調補正＋グローを一番上に追加。" }
    ];

    function run(label, fn) {
        return function () {
            var comp = app.project.activeItem;
            if (!(comp instanceof CompItem)) { alert("コンポを開いてから操作してください。", NAME); return; }
            app.beginUndoGroup(NAME + ": " + label);
            try {
                var msg = fn(comp);
                if (typeof msg === "number") msg = msg + " 個のレイヤーで「" + label + "」を作りました（STG_… / シャイで非表示）。";
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

        var g = row(w);
        g.add("statictext", undefined, "空間:");
        var items = [];
        for (var i = 0; i < KINDS.length; i++) items.push(KINDS[i].label);
        var ddKind = g.add("dropdownlist", undefined, items);
        ddKind.selection = 0;
        var info = w.add("statictext", undefined, KINDS[0].note, { multiline: true });
        info.alignment = ["fill", "top"];
        info.preferredSize = [320, 32];

        var pO = w.add("panel", undefined, "設定");
        pO.alignChildren = ["left", "top"];
        g = row(pO);
        var etCount = field(g, "個数:", String(KINDS[0].count), 4);
        var etCol = field(g, "色:", "#33CCFF", 7);
        var cbRainbow = g.add("checkbox", undefined, "虹色");
        cbRainbow.value = true;
        g = row(pO);
        var cbInf = g.add("checkbox", undefined, "無限（カメラに合わせて配置し直す）");
        cbInf.value = true;
        g = row(pO);
        g.add("statictext", undefined, "トンネルの形:");
        var shapeItems = [];
        for (i = 0; i < TUNNEL_SHAPES.length; i++) shapeItems.push(TUNNEL_SHAPES[i].label);
        var ddShape = g.add("dropdownlist", undefined, shapeItems);
        ddShape.selection = 1;
        var etSpin = field(g, "回転(°/秒):", "8", 4);
        g = row(pO);
        g.add("statictext", undefined, "パーティクル:");
        var partItems = [];
        for (i = 0; i < PARTICLES.length; i++) partItems.push(PARTICLES[i].label);
        var ddPart = g.add("dropdownlist", undefined, partItems);
        ddPart.selection = 0;
        var cbFull = g.add("checkbox", undefined, "パノラマを一周(360°)");
        cbFull.value = true;
        g = row(pO);
        g.add("statictext", undefined, "表示区間:");
        var secItems = [];
        for (i = 0; i < SECTIONS.length; i++) secItems.push(SECTIONS[i].label);
        var ddSec = g.add("dropdownlist", undefined, secItems);
        ddSec.selection = 0;

        ddKind.onChange = function () {
            var k = KINDS[ddKind.selection.index];
            info.text = k.note;
            etCount.text = String(k.count);
        };

        g = row(w);
        var bMake = g.add("button", undefined, "3D空間を生成");
        bMake.preferredSize = [160, 30];
        bMake.onClick = run("3D空間", function (comp) {
            var k = KINDS[ddKind.selection.index];
            var o = {
                count: Math.max(1, Math.min(800, Math.round(num(etCount.text, k.count)))),
                color: hexToRgb(etCol.text, [0.2, 0.8, 1]),
                rainbow: cbRainbow.value,
                infinite: cbInf.value,
                shape: TUNNEL_SHAPES[ddShape.selection.index].key,
                spin: num(etSpin.text, 8),
                type: PARTICLES[ddPart.selection.index].key,
                fullCircle: cbFull.value,
                size: 0
            };
            LAST_MADE = [];
            var res;
            if (k.key === "tunnel") res = buildTunnel(comp, o);
            else if (k.key === "city") res = buildCity(comp, o);
            else if (k.key === "stage") res = buildStage(comp, o);
            else if (k.key === "clouds") res = buildClouds(comp, o);
            else if (k.key === "particles") res = buildParticles(comp, o);
            else if (k.key === "hw_grave") res = buildGraveyard(comp, o);
            else if (k.key === "hw_hall") res = buildCorridor(comp, o);
            else if (k.key === "hw_field") res = buildPumpkinField(comp, o);
            else if (k.key === "hw_creatures") res = buildCreatures(comp, o);
            else if (k.key === "hw_grade") res = buildHalloweenGrade(comp);
            else if (k.key === "mq_ball") res = buildMasquerade(comp, o);
            else if (k.key === "mq_grade") res = buildMasqueradeGrade(comp);
            else res = buildPanorama(comp, o);
            var sec = applySection(comp, LAST_MADE, SECTIONS[ddSec.selection.index].key);
            if (typeof res === "number") res = res + " 個のレイヤーで「" + k.label + "」を作りました（STG_… / シャイで非表示）。";
            return res + sec;
        });
        var bDel = g.add("button", undefined, "STG_ を全部削除");
        bDel.preferredSize = [140, 30];
        bDel.onClick = run("削除", function (comp) {
            if (!confirm("このコンポの STG_ で始まるレイヤーを全部削除します（取り消し可）。よろしいですか？")) return null;
            return removeStage(comp);
        });

        var tip = w.add("statictext", undefined,
            "・カメラの無いコンポでは、先に Camera 3D Toolkit でリグを作るか、歌詞ビルダーのコンポで実行してください。\n" +
            "・重いときはプレビュー解像度を下げる／個数を減らす。", { multiline: true });
        tip.alignment = ["fill", "top"];

        w.onResizing = w.onResize = function () { this.layout.resize(); };
        w.layout.layout(true);
        if (w instanceof Window) { w.center(); w.show(); }
        return w;
    }

    buildUI(thisObj);
})(this);
