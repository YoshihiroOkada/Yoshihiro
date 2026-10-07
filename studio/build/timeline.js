window.TIMELINE = {
 "title": "サンプル曲",
 "artist": "Yoshihiro",
 "duration": 34,
 "tokens": {
  "_note": "デザイントークンの唯一の元。studio/ はここだけを読む。brand/TOKENS.md は説明用（値は同じに保つ）",
  "color": {
   "ground": "#1C1915",
   "groundRaised": "#29241F",
   "line": "#4A433B",
   "muted": "#A39A8E",
   "ink": "#F2EDE4",
   "accent": "#E8823A"
  },
  "font": {
   "display": {
    "family": "Noto Serif JP",
    "weight": 700
   },
   "text": {
    "family": "Noto Sans JP",
    "weight": 500
   }
  },
  "type": {
   "display": 120,
   "caption": 64,
   "emphasisScale": 1.3,
   "maxChars": 12,
   "maxLines": 2
  },
  "grid": {
   "columns": 12,
   "margin": 0.08,
   "gutter": 0.02,
   "baseline": 8,
   "captionBand": 0.12
  },
  "spring": {
   "camera": {
    "k": 220,
    "d": 30
   },
   "type": {
    "k": 170,
    "d": 27
   },
   "scene": {
    "k": 60,
    "d": 15.5
   }
  },
  "motion": {
   "textIn": 0.5,
   "textOut": 0.35,
   "stagger": 0.03,
   "cameraMove": 0.8,
   "sceneMove": 1.6
  },
  "a11y": {
   "minContrast": 4.5,
   "maxFlashesPerSecond": 3,
   "phoneWidth": 360
  },
  "audio": {
   "lufs": -14,
   "truePeak": -1.5
  }
 },
 "scenes": [
  {
   "id": "OPEN",
   "kind": "open",
   "start": 0,
   "end": 4,
   "teaches": "冒頭の絵（Question）: 墓の上に置かれた仮面"
  },
  {
   "id": "LINE_001",
   "kind": "line",
   "start": 4,
   "end": 7.5,
   "textIn": 4,
   "textOut": 6.7,
   "move": 0.8,
   "anchor": [
    "走り出した"
   ],
   "caption": [
    "夜を越えて 走り出した"
   ],
   "emph": false,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": -0.0605852376576513,
    "zoom": 1.0030979128787294
   }
  },
  {
   "id": "LINE_002",
   "kind": "line",
   "start": 7.5,
   "end": 10.8,
   "textIn": 7.5,
   "textOut": 10,
   "move": 0.8,
   "anchor": [
    "場所へ"
   ],
   "caption": [
    "まだ見ぬ 場所へ"
   ],
   "emph": false,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": 0.10884538163896651,
    "zoom": 1.0349514352856204
   }
  },
  {
   "id": "LINE_003",
   "kind": "line",
   "start": 10.8,
   "end": 16,
   "textIn": 10.8,
   "textOut": 14.4,
   "move": 0.8,
   "anchor": [
    "光"
   ],
   "caption": [
    "名前のない",
    "光を追いかけて"
   ],
   "emph": false,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": -0.08607226342661306,
    "zoom": 1.020276084402576
   }
  },
  {
   "id": "LINE_004_CHORUS",
   "kind": "line",
   "start": 16,
   "end": 19.4,
   "textIn": 16,
   "textOut": 18.599999999999998,
   "move": 0.8,
   "anchor": [
    "このメロディ"
   ],
   "caption": [
    "届け 届け このメロディ"
   ],
   "emph": true,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": 0.08331163162598386,
    "zoom": 1.12
   }
  },
  {
   "id": "LINE_005_CHORUS",
   "kind": "line",
   "start": 19.4,
   "end": 23,
   "textIn": 19.4,
   "textOut": 21.4,
   "move": 0.8,
   "anchor": [
    "空の向こう"
   ],
   "caption": [
    "空の向こうまで"
   ],
   "emph": true,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": -0.07199625929584727,
    "zoom": 1.12
   }
  },
  {
   "id": "LINE_006",
   "kind": "line",
   "start": 23,
   "end": 26.6,
   "textIn": 23,
   "textOut": 25.8,
   "move": 0.8,
   "anchor": [
    "耳をすませば"
   ],
   "caption": [
    "息を止めて 耳をすませば"
   ],
   "emph": false,
   "auto": true,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": 0.0876662801974453,
    "zoom": 1.0364911044947802
   }
  },
  {
   "id": "LINE_007",
   "kind": "line",
   "start": 26.6,
   "end": 30.6,
   "textIn": 26.6,
   "textOut": 30.6,
   "move": 0.8,
   "anchor": [
    "君の声"
   ],
   "caption": [
    "聞こえるよ 君の声"
   ],
   "emph": false,
   "auto": false,
   "tooLong": false,
   "needsAnchor": false,
   "shot": {
    "x": -0.0728907780512236,
    "zoom": 1.0077974181971512
   }
  },
  {
   "id": "PAYOFF",
   "kind": "payoff",
   "start": 30.6,
   "end": 34,
   "teaches": "冒頭の絵に戻る（Payoff）"
  }
 ],
 "camKeys": [
  [
   0,
   [
    0,
    1
   ]
  ],
  [
   3.2,
   [
    -0.0605852376576513,
    1.0030979128787294
   ]
  ],
  [
   6.7,
   [
    0.10884538163896651,
    1.0349514352856204
   ]
  ],
  [
   10,
   [
    -0.08607226342661306,
    1.020276084402576
   ]
  ],
  [
   15.2,
   [
    0.08331163162598386,
    1.12
   ]
  ],
  [
   18.599999999999998,
   [
    -0.07199625929584727,
    1.12
   ]
  ],
  [
   22.2,
   [
    0.0876662801974453,
    1.0364911044947802
   ]
  ],
  [
   25.8,
   [
    -0.0728907780512236,
    1.0077974181971512
   ]
  ],
  [
   30.6,
   [
    0,
    1
   ]
  ]
 ],
 "chorus": [
  [
   16,
   23
  ]
 ],
 "props": [
  {
   "section": "verse",
   "id": "tomb",
   "x": -0.8174314602976664,
   "z": 0.6610415274277329,
   "phase": 0.19713726011104882
  },
  {
   "section": "chorus",
   "id": "pillar",
   "x": -0.6471834373660386,
   "z": 0.5259484027512371,
   "phase": 0.5347395255230367
  },
  {
   "section": "verse",
   "id": "cross",
   "x": 0.6537155868834816,
   "z": 0.9367676626890897,
   "phase": 0.2475335942581296
  },
  {
   "section": "chorus",
   "id": "chandelier",
   "x": 0.85111183822155,
   "z": 0.4644750256091356,
   "phase": 0.14365738607011735
  },
  {
   "section": "verse",
   "id": "tree",
   "x": -0.6041254105512053,
   "z": 0.524570727860555,
   "phase": 0.5479014315642416
  },
  {
   "section": "chorus",
   "id": "dancers",
   "x": -0.8047494780272246,
   "z": 0.39471085406839845,
   "phase": 0.912940707989037
  },
  {
   "section": "verse",
   "id": "pumpkin_lit",
   "x": 0.7437987617915497,
   "z": 0.7229749003425241,
   "phase": 0.6800909077282995
  },
  {
   "section": "chorus",
   "id": "pillar",
   "x": 0.886395881511271,
   "z": 0.7246283865068108,
   "phase": 0.9212048600893468
  },
  {
   "section": "verse",
   "id": "tomb",
   "x": -0.8396699694800192,
   "z": 0.3739870843477547,
   "phase": 0.17494154698215425
  },
  {
   "section": "chorus",
   "id": "chandelier",
   "x": -0.642792405653745,
   "z": 0.6051894346717746,
   "phase": 0.020176114281639457
  },
  {
   "section": "verse",
   "id": "cross",
   "x": 0.5808371823397466,
   "z": 0.8108095134142785,
   "phase": 0.3689693051856011
  },
  {
   "section": "chorus",
   "id": "dancers",
   "x": 0.6706862814724446,
   "z": 0.6311975769232958,
   "phase": 0.946221170714125
  },
  {
   "section": "verse",
   "id": "tree",
   "x": -0.7961483800783754,
   "z": 0.7629784805234521,
   "phase": 0.33064792421646416
  },
  {
   "section": "chorus",
   "id": "pillar",
   "x": -0.6425338093191385,
   "z": 0.43327472293749447,
   "phase": 0.13329326012171805
  },
  {
   "section": "verse",
   "id": "pumpkin_lit",
   "x": 0.8695622038678266,
   "z": 0.5434561775997281,
   "phase": 0.19037552690133452
  },
  {
   "section": "chorus",
   "id": "chandelier",
   "x": 0.7528834990225732,
   "z": 0.5520625573582947,
   "phase": 0.04363133409060538
  },
  {
   "section": "verse",
   "id": "tomb",
   "x": -0.7894888220005669,
   "z": 0.9028230633120984,
   "phase": 0.5478726429864764
  },
  {
   "section": "chorus",
   "id": "dancers",
   "x": -0.8306310097686946,
   "z": 0.7431466291192919,
   "phase": 0.9198780113365501
  },
  {
   "section": "verse",
   "id": "cross",
   "x": 0.5909644880215638,
   "z": 0.6679574536159634,
   "phase": 0.649166026385501
  },
  {
   "section": "chorus",
   "id": "pillar",
   "x": 0.8564259636215865,
   "z": 0.9262990355491638,
   "phase": 0.8379574753344059
  },
  {
   "section": "verse",
   "id": "tree",
   "x": -0.7579821034683847,
   "z": 0.9283224760089069,
   "phase": 0.9675063244067132
  },
  {
   "section": "chorus",
   "id": "chandelier",
   "x": -0.7194273071363568,
   "z": 0.8411107939667999,
   "phase": 0.005699941888451576
  },
  {
   "section": "verse",
   "id": "pumpkin_lit",
   "x": 0.730625721917022,
   "z": 0.5468338205479085,
   "phase": 0.7242715947795659
  },
  {
   "section": "chorus",
   "id": "dancers",
   "x": 0.7197980407625437,
   "z": 0.8032498116604984,
   "phase": 0.9769339584745467
  },
  {
   "section": "verse",
   "id": "tomb",
   "x": -0.7451436633709818,
   "z": 0.8438956919126213,
   "phase": 0.42999413376674056
  },
  {
   "section": "chorus",
   "id": "pillar",
   "x": -0.7569405600428581,
   "z": 0.7931322011630981,
   "phase": 0.5516967086587101
  },
  {
   "section": "verse",
   "id": "cross",
   "x": 0.6593343395506963,
   "z": 0.49210110721178346,
   "phase": 0.009314818307757378
  },
  {
   "section": "chorus",
   "id": "chandelier",
   "x": 0.509629122633487,
   "z": 0.9160381445195526,
   "phase": 0.8333689128048718
  }
 ],
 "assets": {},
 "missing": [
  "bg_graveyard",
  "bg_ballroom",
  "mask",
  "tomb",
  "cross",
  "tree",
  "pumpkin_lit",
  "light",
  "pillar",
  "chandelier",
  "dancers"
 ],
 "beats": null
};
