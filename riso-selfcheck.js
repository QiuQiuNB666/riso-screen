// ============ riso 网点自检 ============
// 放在 riso-screen.js 之后，浏览器里跑 risoSelfCheck() 或 headless 里读 window.__risoCheck。
// 只依赖引擎已有的 INK / L / OFFSET / mulberry32 / R，不写任何画面。
// 逻辑坏掉时会 FAIL —— 尤其是最容易静默失效的那条：pattern 缓存 key 漏了 variant。
function risoSelfCheck(){
  var out = [], probe = document.createElement('canvas'), N = 504;
  probe.width = probe.height = N; var px = probe.getContext('2d');
  function ok(name, cond, info){ out.push({ name:name, pass:!!cond, info:info }) }

  // 用 pattern 铺满探针画布，返回平均 alpha = 实际覆盖率
  function cover(pat, blocks){
    px.setTransform(1,0,0,1,0,0); px.clearRect(0,0,N,N);
    px.fillStyle = pat; px.fillRect(0,0,N,N);
    var d = px.getImageData(0,0,N,N).data, s = 0, i;
    for (i=3; i<d.length; i+=4) s += d[i];
    if (!blocks) return s/(d.length/4)/255;
    // 分块覆盖率的变异系数：tile 有接缝的话某些块会系统性偏低
    var B = blocks, bw = N/B, v = [], bx, by, x, y, t2;
    for (by=0; by<B; by++) for (bx=0; bx<B; bx++){
      t2 = 0;
      for (y=by*bw; y<(by+1)*bw; y++) for (x=bx*bw; x<(bx+1)*bw; x++) t2 += d[(y*N+x)*4+3];
      v.push(t2/(bw*bw)/255);
    }
    var m = v.reduce(function(a,b){return a+b})/v.length, sd = 0;
    for (i=0; i<v.length; i++) sd += (v[i]-m)*(v[i]-m);
    return { mean:s/(d.length/4)/255, cv:Math.sqrt(sd/v.length)/m };
  }
  function hash(pat){
    px.setTransform(1,0,0,1,0,0); px.clearRect(0,0,N,N);
    px.fillStyle = pat; px.fillRect(0,0,N,N);
    var d = px.getImageData(0,0,N,N).data, h = 2166136261, i;
    for (i=3; i<d.length; i+=4){ h ^= d[i]; h = Math.imul(h, 16777619) }
    return h>>>0;
  }

  // 1. 角度：两两相差必须 ≥30°(mod 90)，否则三版叠印锁出摩尔纹
  var ks = ['warm','cool','dark'], i2, j2, worst = 90;
  for (i2=0; i2<3; i2++) for (j2=i2+1; j2<3; j2++){
    var d0 = Math.abs(SCREEN[ks[i2]]-SCREEN[ks[j2]]) % 90;
    worst = Math.min(worst, Math.min(d0, 90-d0));
  }
  ok('角度两两≥30°', worst >= 29.9, '最小夹角 '+worst.toFixed(1)+'°');

  // 2. tile 是整数像素，否则每 PAT_CELLS 格一次相位跳，旋转后连成周期性接缝
  ok('tile 整数像素', STS === Math.round(STS) && STS*PAT_K === Math.round(STS*PAT_K),
     'tile '+STS+'px / 超采样 '+(STS*PAT_K)+'px');
  ok('K≥4', PAT_K >= 4, 'PAT_K='+PAT_K);   // K<4 旋转会把点糊成噪点

  // 3. 几何：网点永远碰不到 tile 边界（低调区抖动 + 半径上限）
  var cellS = STS*PAT_K/PAT_CELLS, bad = null, lv;
  for (lv=1; lv<TONE_LEVELS; lv++){
    var tt = lv/TONE_LEVELS;
    var rr2 = cellS * Math.sqrt((tt<=.5 ? tt : 1-tt)/Math.PI) * 1.1;
    var jd2 = tt<=.5 ? Math.min(JIT_DOT*PAT_K, Math.max(0, cellS*.5 - rr2)) : 0;
    if (rr2 + jd2 > cellS*.5 + 1e-9) bad = lv;
  }
  ok('点不越格边界', bad === null, bad ? ('level '+bad+' 越界') : '全 '+(TONE_LEVELS-1)+' 档通过');

  // 4. 连续色阶：覆盖率单调递增，且实测 ≈ 请求浓度
  setBoil(0);
  var ts = [.05,.1,.2,.3,.4,.5,.55,.6,.7,.8,.9], mono = true, maxErr = 0, k2, kk;
  for (kk=0; kk<3; kk++){
    var prev = -1;
    for (k2=0; k2<ts.length; k2++){
      var want2 = Math.round(Math.min(ts[k2],INK_MAX)*TONE_LEVELS)/TONE_LEVELS;
      var c2 = cover(inkTone(ks[kk], ts[k2]));
      if (c2 <= prev) mono = false;                   // 翻转点(.5)两侧必须接得上，不能有台阶
      prev = c2;
      maxErr = Math.max(maxErr, Math.abs(c2 - want2));
    }
  }
  ok('色阶单调递增(含.5翻转点)', mono, '三墨各 '+ts.length+' 档');
  ok('实测覆盖率≈请求浓度', maxErr < .025, '最大偏差 '+maxErr.toFixed(4));

  // 5. 老名字浓度没走样。
  // 基准是【旧 dotTile 的实测覆盖率】，不是 2πr²/gap² 的公式值 —— 公式不算抗锯齿边缘，偏高。
  // 这条守的是"整部片子的墨量没变，变的只有网点结构"。
  var want = { warm:.7257, cool:.6178, dark:.2914, warmL:.1665, coolL:.1576 }, legacy = [], nm;
  for (nm in want){
    var got = cover(TONE[nm]), e = Math.abs(got-want[nm])/want[nm];
    legacy.push(nm+' '+got.toFixed(4)+'(旧 '+want[nm]+' '+(e*100).toFixed(1)+'%)');
    if (e > .06) ok('老名字浓度 '+nm, false, legacy[legacy.length-1]);
  }
  ok('老名字浓度全部在旧版 ±6%', out.every(function(o){ return o.name.indexOf('老名字浓度 ') !== 0 }),
     legacy.join(' | '));
  ok('TONE.at 存在', typeof TONE.at === 'function', '');

  // 6. 【最容易静默失效的一条】boil 真的换了画面。
  //    pattern 缓存 key 漏掉 variant 的话，这里两个 hash 会相等而其它测试全绿。
  setBoil(0);  var h0 = hash(TONE.dark), c0 = cover(TONE.dark), o0 = OFFSET.warm.slice();
  setBoil(8);  var h1 = hash(TONE.dark), c1 = cover(TONE.dark), o1 = OFFSET.warm.slice();
  setBoil(16); var h2 = hash(TONE.dark), c2b = cover(TONE.dark);
  ok('boil 换版本→画面变', h0!==h1 && h1!==h2 && h0!==h2, [h0,h1,h2].join(','));
  ok('boil 换版本→浓度不变', Math.max(Math.abs(c0-c1),Math.abs(c1-c2b),Math.abs(c0-c2b)) < .006,
     [c0,c1,c2b].map(function(v){return v.toFixed(4)}).join(' / '));   // 密度变化眼睛读成"闪"
  ok('boil 抖了套印', o0[0]!==o1[0] || o0[1]!==o1[1], o0+' → '+o1);
  ok('boil 幅度 ≤.5px', Math.abs(o1[0]-2.5)<=.5 && Math.abs(o1[1]+1.5)<=.5, o1.join(','));
  ok('dark 版钉死不抖', OFFSET.dark[0]===0 && OFFSET.dark[1]===0, OFFSET.dark.join(','));

  // 7. 旋转平铺无接缝。注意：cv 的绝对值主要是分块采样噪声，不能直接当判据 ——
  //    真判据是【同一张 tile 旋转后 cv 不该比不旋转时高】。有接缝的话旋转版会明显更高。
  //    (实测旋转反而更低：旋转把 tile 网格和分块网格解耦了)
  var seam = [];
  for (kk=0; kk<3; kk++){
    var tl = screenTile(ks[kk], 25, 0);
    var pr = L[ks[kk]].createPattern(tl,'repeat');
    pr.setTransform(new DOMMatrix().rotateSelf(SCREEN[ks[kk]]).scaleSelf(1/PAT_K));
    var p0 = L[ks[kk]].createPattern(tl,'repeat');
    p0.setTransform(new DOMMatrix().scaleSelf(1/PAT_K));
    var cr = cover(pr,21), c0r = cover(p0,21);
    seam.push(ks[kk]+' '+SCREEN[ks[kk]]+'° cv '+cr.cv.toFixed(4)+' vs 0° '+c0r.cv.toFixed(4));
    if (cr.cv > c0r.cv*1.5 + .01) ok('旋转平铺无接缝 '+ks[kk], false, seam[seam.length-1]);
    if (Math.abs(cr.mean-c0r.mean) > .01) ok('旋转不丢墨 '+ks[kk], false,
      cr.mean.toFixed(4)+' vs '+c0r.mean.toFixed(4));
  }
  ok('旋转平铺无接缝/不丢墨', out.every(function(o){ return o.name.indexOf('旋转') !== 0 }),
     seam.join(' | '));

  // 8. 【确定性命门】setBoil 绝不能碰全局 R —— 一碰，"这帧用到哪几档 tone"就会改变
  //    手绘线的随机序列，整部片子逐帧玄学漂移。
  R = mulberry32(12345); var a1 = [R(),R(),R()];
  R = mulberry32(12345); setBoil(24); setBoil(32); inkTone('cool', .37);
  var a2 = [R(),R(),R()];
  ok('setBoil 不污染全局 R', a1.join()===a2.join(), a1[0].toFixed(6)+' vs '+a2[0].toFixed(6));

  // 9. BOIL=false 回到审过的画面（零抖动）
  var sv = BOIL; BOIL = false; _boilN = null; setBoil(999);
  ok('BOIL=false 零抖动', OFFSET.warm[0]===2.5 && OFFSET.warm[1]===-1.5 && OFFSET.cool[0]===-2,
     'warm '+OFFSET.warm.join(','));
  BOIL = sv; _boilN = null; setBoil(0);

  // 10. hold：同一个 hold 恒定，不同 hold 通常不同（"一镜一纸"）
  setBoil(0, 3); var hA = _variant; setBoil(500, 3);
  ok('hold 冻结不随帧变', _variant === hA, 'variant='+hA);
  var hs = {}, hh; for (hh=0; hh<8; hh++){ setBoil(0, hh); hs[_variant]=1 }
  ok('hold 能分出不同的纸', Object.keys(hs).length >= 2, 'hold 0..7 命中 '+Object.keys(hs).join(','));
  _boilN = null; setBoil(0);

  var fail = out.filter(function(o){ return !o.pass });
  out.forEach(function(o){ console.log((o.pass?'PASS  ':'FAIL  ')+o.name+(o.info?'   '+o.info:'')) });
  console.log(fail.length ? ('自检失败 '+fail.length+'/'+out.length) : ('自检全绿 '+out.length+'/'+out.length));
  return { pass: fail.length===0, total: out.length, failed: fail, all: out };
}
if (typeof window !== 'undefined') window.__risoCheck = risoSelfCheck;
