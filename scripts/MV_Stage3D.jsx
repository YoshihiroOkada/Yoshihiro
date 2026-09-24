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
    function finish(comp, layers, label) {
        var bg = findLayer(comp, "BG_GRADIENT");
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
        { key: "pano", label: "パノラマ背景", count: 16, note: "横長の背景イラストを選択して実行（個数 = 分割数）。" }
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
            if (k.key === "tunnel") return buildTunnel(comp, o);
            if (k.key === "city") return buildCity(comp, o);
            if (k.key === "stage") return buildStage(comp, o);
            if (k.key === "clouds") return buildClouds(comp, o);
            if (k.key === "particles") return buildParticles(comp, o);
            return buildPanorama(comp, o);
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
