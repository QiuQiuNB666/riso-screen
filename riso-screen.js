// ============ riso 网点：角度表 + 连续色阶 + 逐帧 boil + tile 内缺墨 ============
// 替换 tree.html 第 21~24 行（dotTile / var TONE / initTones 整块）。
// 依赖引擎现成的：INK / L / OFFSET / mulberry32。必须插在 OFFSET 定义之后。
// 25 处 TONE.xxx 调用点一行不用动；新代码可以用 TONE.at(key, t) 取任意浓度。
// 唯一要求：paintFrame 开头加一行 setBoil(f)。

// ---- 网点角度（度）。两两相差 30°(mod 90) = 完整玫瑰花结，三版不同格叠印。----
// 分配按明度：最亮的墨拿最显眼的 15°，最暗的拿人眼最钝的 45°。
// warm #e8552a Y=.238 → 15 ；cool #3b6f9e Y=.148 → 75 ；dark #26252e Y=.019 → 45
// 不要改成 0/30/60：数学等价，但 0° 与像素栅格硬混叠，会出"纱窗"。
var SCREEN = { warm: 15, cool: 75, dark: 45 };

var CELLW      = 5.25;   // 网点格宽(最终px)。旧 dotTile 等效格距 4.95~6.36，取中。
                         // 别低于 4：3px 网点会被 h.264 嚼成蚊式噪声，静帧好看 mp4 糊。
var PAT_K      = 5;      // 超采样倍数。K<4 时旋转会把点糊成噪点，别调低。
var PAT_CELLS  = 8;      // tile = 8×8 格 → 42px 见方，超采样画布 210px。
var TONE_LEVELS= 60;     // 色阶级数。20 档会把 warmL 量化掉 11%；60 档残差已到测量噪声底(±3%)，再细没用。
var SVARS      = 3;      // boil 轮换版本数。2 会读成方波抖动；要加就跳到 5，别回 2。
var BOIL_EVERY = 8;      // 每 8 个输出帧换一版 = 3Hz。线条 boil 是 12Hz，4:1 才分得开。
var BOIL       = true;   // 总开关。false = 冻成 variant 0 + 零套印抖动（回到审过的画面）。
var MISREG     = 1;      // 套印抖动总强度。静止长镜头嫌纸在呼吸就调 0。
var JIT_PLATE  = { warm:.4, cool:.4, dark:0 };  // 各版套印抖动幅度(±px)。
                         // dark=0 是故意的：它是套准基准版(线条版)，钉死了眼睛才有锚点，
                         // 而且 compose 的 drawImage 整数偏移不重采样，主墨永远不糊。
var JIT_DOT    = .45;    // 网点位置抖动(±px)。实际会按格内余量自动收窄，保证不跨 tile 边界。
var INK_MAX    = .92;    // 单墨浓度上限。满墨会让纸消失、三墨糊成死黑；实地请直接用 INK[k]。
var TILE_CAP   = 96;     // tile 缓存上限（210² ≈ 176KB/张 → 约 17MB 封顶）。

var STS = Math.round(CELLW * PAT_CELLS);   // tile 最终边长必须是整数像素，否则每 8 格一次相位跳
var TONE = {};
var _tiles = {}, _tileN = 0, _pats = {}, _variant = 0, _boilN = null;
var _inkSeed = { warm:1, cool:2, dark:3 };

// ---- 一张 tile：某墨 / 某档浓度 / 某个 boil 版本 ----
function screenTile(key, level, variant){
  var ck = key+'|'+level+'|'+variant;
  if (_tiles[ck]) return _tiles[ck];
  if (_tileN >= TILE_CAP){ _tiles = {}; _pats = {}; _tileN = 0; }   // 到顶就整个丢掉，重建 0.2ms/张
  var size = STS * PAT_K, cell = size / PAT_CELLS, t = level / TONE_LEVELS;
  var cv = document.createElement('canvas'); cv.width = cv.height = size;
  var c = cv.getContext('2d');
  // 两条独立随机流，都不碰全局 R —— 一旦动了 R，"这帧用到哪几档 tone"会改变手绘线的
  // 随机序列，整部片子逐帧玄学漂移。
  var rp = mulberry32(_inkSeed[key]*7919 + level*131 + variant*17 + 1);  // 位置：随 variant 变
  var rs = mulberry32(_inkSeed[key]*7919 + 104729);                       // 尺寸：不随 variant 也不随 level 变
  // 种子里【不能带 level】：带了的话每一档都重抽 64 个半径，64 样本的覆盖率噪声(±1%)和
  // 档距(1/60=1.67%)同量级，相邻档实际浓度差能差 2.7 倍 —— 加到 60 档的意义就全没了。
  function qp(a,b){ return a + rp()*(b-a) }
  function qs(a,b){ return a + rs()*(b-a) }
  c.fillStyle = INK[key];

  // 半径倍率查表，按格索引取。两个作用：
  //  1. x=0 与 x=PAT_CELLS 拿到同一个数，tile 左右边界那对半点半径一致，拼起来无台阶
  //  2. 走 rs 流 → 三个 variant 的覆盖率完全相同。位置变化眼睛读成"工艺"，密度变化读成"闪"
  // 区间对称(.9~1.1)：E[m²]=1.003，整体浓度无系统偏差（原版 .86~1.1 会整张浅 3.5%）
  var jr = [], n0;
  for (n0 = 0; n0 < PAT_CELLS*PAT_CELLS; n0++) jr.push(qs(.9, 1.1));
  function JR(x,y){ return jr[(y%PAT_CELLS)*PAT_CELLS + (x%PAT_CELLS)] }

  if (level >= TONE_LEVELS){
    c.fillRect(0,0,size,size);                       // INK_MAX<1 时到不了，抬到 1 才活
  } else if (t <= .5){
    // 低调区：画实心点。点面积 ∝ tone → r = cell·√(t/π)，单格不重叠，覆盖率就等于 t。
    var r = cell * Math.sqrt(t/Math.PI);
    // 位置抖动按格内余量收窄：保证 |偏移| + r·1.1 ≤ cell/2，点永远碰不到 tile 边界 → 旋转平铺无缝
    var room = Math.max(0, cell*.5 - r*1.1), jd = Math.min(JIT_DOT*PAT_K, room);
    for (var y=0; y<PAT_CELLS; y++) for (var x=0; x<PAT_CELLS; x++){
      c.beginPath();
      c.arc((x+.5)*cell + qp(-jd,jd), (y+.5)*cell + qp(-jd,jd), r*JR(x,y), 0, 7);
      c.fill();
    }
  } else {
    // 高调区：t>.5 翻转成"填满 + destination-out 挖白洞"，半径用 (1-t)。
    // 翻转不是被相切逼的(相切在 t=π/4)，是为了让两个分支的半径都 ≤ cell·√(.5/π)——
    // 永不越过格边界和 tile 边界，且色阶在 .5 处导数连续。
    // 挖洞圆心落在格点上(含 0 与 PAT_CELLS 两端)且【位置绝不能抖】：一抖 tile 两侧对不上，
    // 平铺后沿网点角度斜着排出一条条接缝。
    c.fillRect(0,0,size,size);
    c.globalCompositeOperation = 'destination-out';
    var r2 = cell * Math.sqrt((1-t)/Math.PI);
    for (var y2=0; y2<=PAT_CELLS; y2++) for (var x2=0; x2<=PAT_CELLS; x2++){
      c.beginPath(); c.arc(x2*cell, y2*cell, r2*JR(x2,y2), 0, 7); c.fill();
    }
    c.globalCompositeOperation = 'source-over';
  }

  // 缺墨：在 tile 内部挖细碎斑点，跟着网点一起转角度、一起 boil —— 比全局 GRAIN 层更像油墨没上匀。
  // 数量与大小走 rs（不随 variant 变）保证密度稳定，只有位置走 rp。
  // 每个斑点画 4 份（自身 + 左/上/左上各偏一个 tile），跨边界的那些平铺后才接得上；
  // 原版直接 fillRect(R()*size,...) 会被裁掉而不是 wrap，每个 tile 右/下边有条极淡亮线。
  c.globalCompositeOperation = 'destination-out';
  var n = Math.round(size*size / (level >= TONE_LEVELS ? 120 : 230));
  for (var k=0; k<n; k++){
    var s = qs(.6,1.8) * (rs()<.08 ? 2.2 : 1), gx = rp()*size, gy = rp()*size;
    c.globalAlpha = qs(.25,.9);
    c.fillRect(gx,gy,s,s);
    c.fillRect(gx-size,gy,s,s); c.fillRect(gx,gy-size,s,s); c.fillRect(gx-size,gy-size,s,s);
  }
  c.globalAlpha = 1; c.globalCompositeOperation = 'source-over';
  _tileN++;
  return (_tiles[ck] = cv);
}

// ---- 连续色阶：某墨在浓度 t(0~1) 下的 pattern。可以直接当 fillStyle 用。----
function inkTone(key, t){
  var level = Math.max(1, Math.min(TONE_LEVELS, Math.round(Math.min(t, INK_MAX)*TONE_LEVELS)));
  var ck = key+'|'+level+'|'+_variant;        // ← key 必须含 _variant，漏了 boil 就静默失效
  if (_pats[ck]) return _pats[ck];
  var p = L[key].createPattern(screenTile(key, level, _variant), 'repeat');
  // 顺序固定：先缩回超采样，再转到该色版角度。rotateSelf 的单位是【度】不是弧度。
  // 套印偏移不进这里 —— 你是三层 + compose() 里 drawImage(OFFSET) 整版平移，那才是真印刷
  // （整块版错位、线条跟着错）。塞进 pattern 会叠两遍，而且线条不会跟着动。
  if (p.setTransform) p.setTransform(new DOMMatrix().rotateSelf(SCREEN[key]||0).scaleSelf(1/PAT_K));
  return (_pats[ck] = p);
}

// ---- 老名字 → 等效浓度。----
// 不是按 2πr²/gap² 的公式反推的 —— 公式值(.74/.62/.32/.17/.15)偏高，因为它不算抗锯齿边缘。
// 下面这组是把【旧 dotTile 和新 pattern 放在同一个探针画布里实测平均 alpha】搜出来的，
// 所以整部片子的墨量守恒，改的只有网点结构(角度/连续色阶/boil)，不是浓淡。
//        旧实测 → 新实测       误差
//  warm  .7257 → .7124       -1.8%
//  cool  .6178 → .6228       +0.8%
//  dark  .2914 → .2916       +0.1%
//  warmL .1665 → .1612       -3.2%
//  coolL .1576 → .1580       +0.3%（原标定 .167 偏浓 6.3%，实测后改的）
// 残差是抗锯齿/重采样的噪声底，不是量化误差。想整体调浓淡改这几个数就行。
function initTones(){
  TONE.warm  = inkTone('warm', .717);
  TONE.cool  = inkTone('cool', .617);
  TONE.dark  = inkTone('dark', .300);
  TONE.warmL = inkTone('warm', .167);
  TONE.coolL = inkTone('cool', .158);
  TONE.at    = inkTone;
}

// ---- 逐帧 boil。paintFrame 第一句调一次 setBoil(f)。----
// f 是输出帧号(24fps)，但 __frame 做了 on-twos 所以 f 走 0,2,4…，作画 12fps。
// /8 → 每 8 个输出帧(4 个作画帧)换一版 = 3Hz。网点必须比线条(12Hz)慢一个量级，
// 同频会退化成网点爬行 + 全画面闪烁，而不是"手工感"。
// 第二参 hold：传任意值(比如镜头序号)就冻结成该值对应的版本 —— "一镜一纸"，
// 长静止镜头 / 结尾校样单用它，线条 boil 留着，一层活着就够了。
var OFFSET0 = { warm: OFFSET.warm.slice(), cool: OFFSET.cool.slice(), dark: OFFSET.dark.slice() };
function setBoil(f, hold){
  // key 必须带模式：hold=0 和 BOIL=false 都会算出 0，撞了就 early-return，
  // 把上一镜头的套印抖动原样留下 —— "关掉 boil 回到审过的画面"会失效。
  var i = (hold != null) ? ((hold|0)*2654435761 & 0x7fffffff)
                         : (BOIL ? Math.floor(f/BOIL_EVERY) : 0);
  var b = (hold != null ? 'h' : BOIL ? 'b' : 'off') + i;
  if (b === _boilN) return;                  // 没换版本就别重建 pattern
  _boilN = b; _variant = ((i % SVARS) + SVARS) % SVARS;
  var jr = mulberry32(9001 + _variant), amp = (BOIL || hold != null) ? MISREG : 0, k;
  // 固定 OFFSET 负责"这是印刷品"的静态读法，抖动只负责"不是数字完美"。
  // >1px 眼睛会追着色层自己动(读成图层在晃)，<.2px 被抗锯齿吃掉。±.4 正好。
  for (k in OFFSET0){
    var a = (JIT_PLATE[k] || 0) * amp, u = jr()-.5, v = jr()-.5;   // 两个数照抽，改幅度不会重排别的墨
    OFFSET[k] = [ OFFSET0[k][0] + u*2*a, OFFSET0[k][1] + v*2*a ];
  }
  initTones();
}
