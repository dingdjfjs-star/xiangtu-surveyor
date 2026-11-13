/* ============================================================
 * 浏览器薄壳：hash 路由 + 全部视图（学生端 7 视图 / 教师端 1 页 4 区）
 * 纪律：引擎逻辑不进本文件——UI 只调 XT_ENGINE；状态落 localStorage('xiangtu1')
 * ============================================================ */
(function () {
  'use strict';
  const BOOK = window.XT_BOOK, VILLAGES = window.XT_VILLAGES, E = window.XT_ENGINE, PR = window.XT_PROMPTS;
  const LS_KEY = 'xiangtu1';
  const app = document.getElementById('app');

  /* ---------- 状态 ---------- */
  let state = null;
  function load() {
    try { state = E.deserialize(localStorage.getItem(LS_KEY)) || E.newState(); } catch (e) { state = E.newState(); }
  }
  function save() {
    try { localStorage.setItem(LS_KEY, E.serialize(state)); } catch (e) { /* 隐身模式等场景静默 */ }
  }

  /* ---------- 工具 ---------- */
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  function toast(msg) {
    const t = document.createElement('div');
    t.className = 'toast'; t.textContent = msg;
    document.body.appendChild(t);
    setTimeout(() => t.classList.add('on'), 30);
    setTimeout(() => { t.classList.remove('on'); setTimeout(() => t.remove(), 400); }, 2200);
  }
  function downloadText(name, text) {
    const blob = new Blob([text], { type: 'text/markdown;charset=utf-8' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  }
  function printSheet(title, lines) {
    let el = document.getElementById('print-sheet');
    if (!el) { el = document.createElement('div'); el.id = 'print-sheet'; document.body.appendChild(el); }
    el.innerHTML = '<h1>' + esc(title) + '</h1>' + lines.map(l => '<pre class="ps-line">' + (l === '' ? ' ' : esc(l)) + '</pre>').join('');
    window.print();
  }
  function go(hash) { location.hash = hash; }
  function parseRoute() {
    const h = (location.hash || '#/').replace(/^#\/?/, '');
    const parts = (h.split('?')[0] || '').split('/');
    const partsArr = (h.split('?')[0]) ? parts : [];
    partsArr.query = {};
    const qs = h.split('?')[1];
    if (qs) qs.split('&').forEach(kv => { const p = kv.split('='); partsArr.query[p[0]] = p[1] || ''; });
    return partsArr;
  }
  function chConceptPool(village) { return VILLAGES.conceptPool(village.id); }

  /* ---------- SVG 村落图 ---------- */
  // 村落图腾小图标（窑洞/水乡桥屋/围屋/鼓楼），用于村落卡
  const VIL_GLYPHS = {
    v1: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3.5,18 Q3.5,9 12,9 Q20.5,9 20.5,18 Z" fill="#b9c9ae" stroke="#2b3a33"/><path d="M8.5,18 Q8.5,12.5 12,12.5 Q15.5,12.5 15.5,18 Z" fill="#b0713a" stroke="#2b3a33"/><rect x="10.8" y="14.5" width="2.4" height="3.5" fill="#3f5a4d"/></svg>',
    v2: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.5,16 Q12,11 21.5,16" fill="none" stroke="#3f5a78" stroke-width="1.8"/><path d="M2.5,19.5 Q12,14.5 21.5,19.5" fill="none" stroke="#3f5a78" stroke-width="1.8"/><path d="M9,15 V9.5 L12,6.5 L15,9.5 V15" fill="#e9efe4" stroke="#2b3a33"/><path d="M12,6.5 V15" stroke="#2b3a33" stroke-width=".8"/></svg>',
    v3: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M3,13 A9,9 0 0,0 21,13" fill="none" stroke="#6b8f71" stroke-width="1.7"/><path d="M7,13 A5,5 0 0,0 17,13" fill="none" stroke="#6b8f71" stroke-width="1.4"/><path d="M9.5,13 V8.5 H14.5 V13" fill="#b5543f" stroke="#2b3a33"/><path d="M8.5,8.5 L12,5 L15.5,8.5 Z" fill="#2f5d62" stroke="#2b3a33"/></svg>',
    v4: '<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12,3.5 L20.5,8.5 H3.5 Z" fill="#2f5d62" stroke="#2b3a33"/><path d="M8.5,8.5 L18.5,12.5 H5.5 Z" fill="#3f6b5a" stroke="#2b3a33"/><rect x="10" y="12.5" width="4" height="6.5" fill="#4a6157" stroke="#2b3a33"/></svg>'
  };
  // 要素按社会功能分类配色（礼治/教化/居住/生计/市集交通），供地图与图例共用
  function catOf(kind) {
    if (['hall', 'shrine', 'gate', 'plaza'].indexOf(kind) >= 0) return { c: '#b5543f', label: '礼治 · 公共空间' };
    if (['school', 'genealogy'].indexOf(kind) >= 0) return { c: '#2f5d62', label: '教化 · 文墨' };
    if (['homes', 'ladies', 'ladies2', 'teahouse', 'inn', 'workshop', 'kiln', 'stove'].indexOf(kind) >= 0) return { c: '#6b8f71', label: '居住 · 生活' };
    if (['field', 'yard', 'grove', 'tree'].indexOf(kind) >= 0) return { c: '#c8a15a', label: '田畴 · 生计' };
    if (kind === 'pond') return { c: '#7fa8b8', label: '水系 · 风水' };
    return { c: '#3f5a78', label: '市集 · 交通 · 新生' };
  }
  function mapLegendHtml() {
    const cats = [];
    ['hall', 'school', 'homes', 'field', 'street', 'pond'].forEach(k => {
      const cat = catOf(k);
      if (!cats.some(s => s.label === cat.label)) cats.push(cat);
    });
    return '<div class="maplegend">' + cats.map(s => '<span class="lg"><i style="background:' + s.c + '"></i>' + s.label + '</span>').join('') + '</div>';
  }
  // 首页 hero 宽幅横卷：远山/雾带/梯田/河流/村舍/飞鸟 + 朱砂调查路线贯穿四村（①②③④）
  function heroSceneSVG() {
    return `<svg class="heroscene" viewBox="0 0 880 240" preserveAspectRatio="xMidYMid slice" role="img" aria-label="手绘横卷：远山、梯田、村舍、河流与贯穿四村的调查路线">
      <g fill="none" stroke="#4a6157" stroke-width="1.2" opacity=".55">
        <path d="M96,44 q10,-14 24,-7 q5,-12 20,-8 q15,-3 17,9 q13,1 11,11"/>
        <path d="M676,36 q10,-14 24,-7 q5,-12 20,-8 q15,-3 17,9 q13,1 11,11"/>
      </g>
      <circle cx="828" cy="40" r="14" fill="none" stroke="#b5543f" stroke-width="1.6" opacity=".75"/>
      <circle cx="828" cy="40" r="5" fill="none" stroke="#b5543f" stroke-width="1" opacity=".45"/>
      <path d="M0,150 Q80,96 160,132 Q240,166 320,128 Q400,92 480,130 Q560,164 640,126 Q720,92 880,140 L880,240 L0,240 Z" fill="#9db8a8" opacity=".55"/>
      <rect x="0" y="148" width="880" height="26" fill="#eef2ec" opacity=".5"/>
      <path d="M0,186 Q110,150 220,176 Q330,200 440,172 Q560,146 660,178 Q770,204 880,178 L880,240 L0,240 Z" fill="#7fa08f" opacity=".5"/>
      <rect x="0" y="192" width="880" height="20" fill="#eef2ec" opacity=".45"/>
      <g stroke="#b0713a" opacity=".45" stroke-width=".8" fill="none">
        <path d="M30,158 q40,-10 78,-2"/><path d="M42,166 q36,-8 66,-1"/><path d="M56,174 q30,-7 54,0"/>
        <line x1="648" y1="204" x2="700" y2="199"/><line x1="646" y1="210" x2="706" y2="205"/>
        <line x1="730" y1="206" x2="792" y2="200"/><line x1="728" y1="212" x2="798" y2="206"/>
        <line x1="60" y1="212" x2="140" y2="206"/><line x1="58" y1="218" x2="146" y2="212"/>
      </g>
      <path d="M312,240 C342,198 306,172 348,142 C376,122 424,126 452,112 L474,112 C446,130 400,126 376,148 C348,174 378,200 358,240 Z" fill="#8fb6c4" opacity=".85"/>
      <path d="M310,240 C340,196 304,170 346,140" fill="none" stroke="#2b3a33" stroke-width="1" opacity=".4"/>
      <g stroke="#2b3a33" stroke-width="1.2" opacity=".75">
        <line x1="330" y1="184" x2="368" y2="178"/><line x1="332" y1="192" x2="366" y2="186"/>
      </g>
      <g stroke="#2b3a33" stroke-width="1.1" fill="#f0f5ee">
        <path d="M556,204 v-12 h22 v12 Z"/><path d="M551,192 L567,178 L583,192 Z" fill="#2f5d62"/>
        <path d="M598,200 v-10 h19 v10 Z"/><path d="M594,190 L607.5,178 L621,190 Z" fill="#2f5d62"/>
        <path d="M642,203 v-12 h21 v12 Z"/><path d="M637,191 L652.5,177 L668,191 Z" fill="#2f5d62"/>
        <rect x="564" y="196" width="5" height="8" fill="#4a6157" stroke="none"/>
        <rect x="605" y="193" width="5" height="7" fill="#4a6157" stroke="none"/>
        <rect x="650" y="195" width="5" height="8" fill="#4a6157" stroke="none"/>
        <g fill="none" opacity=".8">
          <circle cx="722" cy="212" r="10"/>
          <line x1="712" y1="212" x2="732" y2="212"/><line x1="722" y1="202" x2="722" y2="222"/>
        </g>
        <path d="M688,206 h8 v10 h-8 Z" fill="#c5d4bd"/>
      </g>
      <g fill="#6b8f71" stroke="#2b3a33" stroke-width=".9">
        <circle cx="38" cy="212" r="6"/><circle cx="66" cy="218" r="5"/><circle cx="776" cy="212" r="6"/><circle cx="836" cy="218" r="5"/>
        <path d="M38,218 v7 M66,223 v6 M776,218 v7 M836,223 v6" fill="none" stroke="#4a6157"/>
      </g>
      <g fill="none" stroke="#2b3a33" stroke-width="1.2" opacity=".65">
        <path d="M238,58 q6,-7 12,0 M256,50 q6,-7 12,0"/>
        <path d="M540,54 q6,-7 12,0 M558,46 q6,-7 12,0"/>
      </g>
      <path d="M44,214 C140,190 216,232 322,214 C424,197 466,232 558,214 C646,196 700,230 806,206"
            fill="none" stroke="#b5543f" stroke-width="2" stroke-dasharray="7 5" opacity=".85"/>
      <g font-family="serif">
        <g stroke="#b5543f" stroke-width="1.8" fill="#f4f7ef">
          <circle cx="104" cy="204" r="9"/><circle cx="304" cy="221" r="9"/><circle cx="560" cy="213" r="9"/><circle cx="806" cy="206" r="9"/>
        </g>
        <g fill="#b5543f" font-size="11" font-weight="bold" text-anchor="middle">
          <text x="104" y="208">1</text><text x="304" y="225">2</text><text x="560" y="217">3</text><text x="806" y="210">4</text>
        </g>
        <g fill="#3f5a4d" font-size="11" text-anchor="middle" opacity=".85">
          <text x="104" y="228">槐荫村</text><text x="304" y="238">荻塘村</text><text x="560" y="230">围龙村</text><text x="806" y="222">云岭寨</text>
        </g>
      </g>
    </svg>`;
  }
  function markerShape(kind) {
    switch (kind) {
      case 'hall': return '<rect x="-7" y="-5" width="14" height="10" rx="1"/><path d="M-9 -5 L0 -11 L9 -5"/>';
      case 'tree': return '<circle cx="0" cy="-4" r="6"/><line x1="0" y1="2" x2="0" y2="7"/>';
      case 'yard': return '<rect x="-8" y="-6" width="16" height="12" rx="1"/><line x1="-4" y1="-6" x2="-4" y2="6"/><line x1="4" y1="-6" x2="4" y2="6"/>';
      case 'homes': return '<rect x="-9" y="-2" width="6" height="5"/><rect x="-2" y="-5" width="6" height="8"/><rect x="5" y="-1" width="5" height="4"/>';
      case 'pond': return '<ellipse cx="0" cy="0" rx="9" ry="5"/>';
      case 'shrine': return '<rect x="-6" y="-3" width="12" height="8"/><path d="M-8 -3 L0 -9 L8 -3"/>';
      case 'school': return '<rect x="-7" y="-4" width="14" height="9"/><line x1="-7" y1="-4" x2="-7" y2="-9"/><path d="M-7 -9 L-2 -8 L-7 -7"/>';
      case 'road': return '<line x1="-10" y1="3" x2="10" y2="-3"/><line x1="-10" y1="-1" x2="10" y2="-7"/>';
      case 'kiln': return '<path d="M-8 5 Q-8 -6 0 -6 Q8 -6 8 5"/>';
      case 'stove': return '<circle cx="0" cy="0" r="6"/>';
      case 'street': return '<rect x="-10" y="-3" width="20" height="6" rx="1"/>';
      case 'field': return '<rect x="-9" y="-5" width="18" height="10" rx="2"/><path d="M-9 -2 H9 M-9 1 H9"/>';
      case 'teahouse': return '<rect x="-7" y="-3" width="14" height="8"/><path d="M-9 -3 L0 -10 L9 -3"/>';
      case 'ladies': return '<rect x="-6" y="-3" width="12" height="8"/><path d="M-8 -3 L0 -9 L8 -3"/><line x1="-2" y1="5" x2="-2" y2="8"/>';
      case 'market': return '<path d="M-9 0 L0 -8 L9 0"/><rect x="-8" y="0" width="16" height="6"/>';
      case 'inn': return '<rect x="-8" y="-4" width="16" height="9"/><path d="M-10 -4 L0 -11 L10 -4"/>';
      case 'new': return '<rect x="-7" y="-3" width="14" height="8"/><line x1="0" y1="-3" x2="0" y2="-9"/><circle cx="0" cy="-10" r="1.5"/>';
      case 'genealogy': return '<rect x="-6" y="-7" width="12" height="14"/><line x1="-3" y1="-3" x2="3" y2="-3"/><line x1="-3" y1="0" x2="3" y2="0"/><line x1="-3" y1="3" x2="3" y2="3"/>';
      case 'grove': return '<circle cx="-5" cy="-3" r="4"/><circle cx="4" cy="-5" r="5"/><circle cx="0" cy="3" r="4"/>';
      case 'workshop': return '<rect x="-7" y="-2" width="14" height="8"/><path d="M-7 -2 L0 -8 L7 -2"/>';
      case 'plaza': return '<circle cx="0" cy="0" r="8"/><circle cx="0" cy="0" r="3"/>';
      case 'gate': return '<line x1="-6" y1="-6" x2="-6" y2="6"/><line x1="6" y1="-6" x2="6" y2="6"/><line x1="-8" y1="-6" x2="8" y2="-6"/>';
      case 'ladies2': return '<rect x="-6" y="-3" width="12" height="8"/><path d="M-8 -3 L0 -9 L8 -3"/>';
      default: return '<rect x="-6" y="-6" width="12" height="12"/>';
    }
  }
  function villageDecor(v) {
    const t = v.mapTheme;
    if (v.id === 'v1') return `
      <path d="M0,100 L0,64 Q25,58 50,62 Q75,66 100,60 L100,100 Z" fill="${t.hill}" opacity=".55"/>
      <path d="M100,20 Q88,30 86,44 Q95,52 100,50" fill="none" stroke="${t.accent}" stroke-width=".6" opacity=".4"/>
      <path d="M96,10 Q86,22 85,36 Q92,46 100,44" fill="none" stroke="${t.accent}" stroke-width=".6" opacity=".3"/>
      <g stroke="${t.accent}" opacity=".28" stroke-width=".5">${Array.from({ length: 9 }, (_, i) => `<line x1="${4 + i * 11}" y1="82" x2="${10 + i * 11}" y2="92"/>`).join('')}</g>
      <text x="6" y="96" font-size="3.4" fill="#4a6157">塬上麦田</text>
      <text x="80" y="22" font-size="3.4" fill="#4a6157">沟壑</text>`;
    if (v.id === 'v2') return `
      <path d="M-5,58 Q25,50 50,56 Q78,62 105,54 L105,66 Q78,74 50,68 Q25,62 -5,70 Z" fill="${t.water}" opacity=".75"/>
      <g fill="none" stroke="${t.accent}" opacity=".35" stroke-width=".5">
        <circle cx="84" cy="36" r="6"/><circle cx="92" cy="44" r="6"/><circle cx="80" cy="46" r="5"/><circle cx="90" cy="28" r="5"/>
      </g>
      <text x="76" y="58" font-size="3.4" fill="#57736b">桑基鱼塘</text>
      <rect x="46" y="50" width="8" height="14" fill="${t.roof}" opacity=".4"/>
      <text x="6" y="52" font-size="3.4" fill="#57736b">市河</text>`;
    if (v.id === 'v3') return `
      <path d="M-5,10 Q50,-8 105,10 L105,22 Q50,4 -5,22 Z" fill="${t.hill}" opacity=".5"/>
      <path d="M-5,86 Q50,104 105,86 L105,96 Q50,112 -5,96 Z" fill="${t.hill}" opacity=".5"/>
      <path d="M50,64 A26,26 0 1 0 50.1,64" fill="none" stroke="${t.roof}" stroke-width="1.2" opacity=".35"/>
      <path d="M50,64 A19,19 0 1 0 50.1,64" fill="none" stroke="${t.roof}" stroke-width="1.1" opacity=".3"/>
      <path d="M24,64 A26,26 0 0 1 76,64" fill="none" stroke="${t.accent}" stroke-width="0" />
      <text x="68" y="96" font-size="3.6" fill="#4a6157">半月池方向</text>
      <text x="6" y="16" font-size="3.4" fill="#4a6157">北面山岭</text>`;
    return `
      <path d="M-5,30 Q30,18 60,26 Q85,32 105,24" fill="none" stroke="${t.hill}" stroke-width="3" opacity=".6"/>
      <path d="M-5,44 Q30,32 62,40 Q86,46 105,38" fill="none" stroke="${t.hill}" stroke-width="3" opacity=".5"/>
      <path d="M-5,58 Q28,48 58,54 Q84,60 105,52" fill="none" stroke="${t.hill}" stroke-width="3" opacity=".45"/>
      <g stroke="${t.accent}" opacity=".3" stroke-width=".5">${Array.from({ length: 7 }, (_, i) => `<line x1="${30 + i * 10}" y1="66" x2="${26 + i * 10}" y2="78"/>`).join('')}</g>
      <text x="70" y="86" font-size="3.4" fill="#57736b">层叠梯田</text>
      <text x="6" y="34" font-size="3.4" fill="#57736b">苗岭坡地</text>`;
  }
  function drawMap(v, state, interactive) {
    const t = v.mapTheme;
    const marks = v.features.map(f => {
      const fs = state ? (state.villages[v.id] || {}).features : null;
      const st = fs && fs[f.id];
      const seen = st && (st.seen || (st.myTags || []).length);
      const cls = 'fm' + (seen ? ' seen' : '');
      return `<g class="${cls}" transform="translate(${f.x},${f.y})" ${interactive ? `data-fid="${f.id}" tabindex="0"` : ''}>
        <g fill="${catOf(f.kind).c}" stroke="#2b3a33" stroke-width=".55" opacity=".92">${markerShape(f.kind)}</g>
        <text x="0" y="14" text-anchor="middle" font-size="3.7" fill="#24413d" style="paint-order:stroke" stroke="${t.ground}" stroke-width="1.1">${esc(f.name)}</text>
      </g>`;
    }).join('');
    return `<svg class="vmap" viewBox="0 0 100 100" preserveAspectRatio="xMidYMid meet" role="img" aria-label="${esc(v.name)}村落平面手绘图">
      <rect x="0" y="0" width="100" height="100" fill="${t.ground}"/>
      ${villageDecor(v)}
      ${marks}
    </svg>`;
  }

  /* ---------- 视图：首页 ---------- */
  function viewHome() {
    const lvl = E.levelOf(state.points);
    const achN = state.achievements.length;
    const readN = Object.keys(state.chapters).length;
    const saying = BOOK.dailySaying();
    const chCards = BOOK.CHAPTERS.map(c => {
      const read = state.chapters[c.id] && state.chapters[c.id].read;
      const vil = VILLAGES.village(c.village);
      return `<a class="chcard ${read ? 'read' : ''}" style="--spine:${(vil.mapTheme && vil.mapTheme.roof) || '#b5543f'}" data-no="${c.no}" href="#/book/${c.id}">
        <div class="chno">${c.no}</div>
        <div class="chbody">
          <div class="chtitle">${esc(c.title)} <span class="chtheme">${esc(c.theme)}</span></div>
          <div class="chblurb">${esc(c.blurb)}</div>
          <div class="chmeta"><span class="chip">${esc(vil.name)}·${esc(vil.type)}</span><span class="chip ghost">${esc(c.geo)}</span></div>
        </div>
        ${read ? '<div class="stamp-read">读毕</div>' : ''}
      </a>`;
    }).join('');
    const vilCards = VILLAGES.VILLAGES.map(v => {
      const vs = state.villages[v.id];
      const obsN = vs ? Object.keys(vs.features || {}).length : 0;
      const matN = vs ? Object.keys(vs.talks || {}).reduce((n, k) => n + vs.talks[k].materials.length, 0) : 0;
      const spine = (v.mapTheme && v.mapTheme.roof) || '#7a5a38';
      return `<a class="vilcard" style="--spine:${spine}" href="#/village/${v.id}">
        <div class="vilname"><span class="vilglyph">${VIL_GLYPHS[v.id] || ''}</span>${esc(v.name)}</div>
        <div class="viltype">${esc(v.type)} · ${esc(v.region)}</div>
        <div class="vilprog">观察 ${obsN}/${v.features.length} · 素材 ${matN} 条${vs && vs.report && vs.report.submitted ? ' · 报告已交' : ''}</div>
      </a>`;
    }).join('');
    return `
    <header class="hero">
      <div class="hero-badge">整本书阅读 × 人文地理 · 跨学科探究</div>
      <h1>乡土调查员</h1>
      <p class="hero-sub">——费孝通《乡土中国》田野探究工作坊——</p>
      <div class="hero-scenewrap">
        <div class="tape tl"></div><div class="tape tr"></div>
        ${heroSceneSVG()}
        <div class="hero-anno">驻村要点：先看地，再问人，后对书。</div>
        <div class="scene-cap">调查路线图 · 四村环线（与页脚「村落图鉴」编号对应）</div>
      </div>
      <p class="hero-saying">「${esc(saying)}」</p>
      <div class="hero-stat">
        <span class="chip big">${esc(lvl.name)}</span>
        <span class="chip ghost big">调查积分 ${state.points}</span>
        <span class="chip ghost big">读毕 ${readN}/14 章</span>
        <span class="chip ghost big">成就 ${achN}/${E.ACHIEVEMENTS.length}</span>
      </div>
      <div class="hero-nav">
        <a class="btn" href="#/compare">区域对比</a>
        <a class="btn" href="#/ach">成就图鉴</a>
        <a class="btn ghost" href="#/teacher">教师端</a>
        <a class="btn ghost" href="#/settings">设置·考据</a>
      </div>
    </header>
    <section class="sec"><h2>选章 · 开启驻村任务</h2><p class="sec-sub">从 14 章中选择主题，每章配一处对口的虚拟村落；读章、驻村、访谈、分析、成文，一条线走完。</p>
      <div class="chgrid">${chCards}</div>
    </section>
    <section class="sec"><h2>村落图鉴</h2><p class="sec-sub">四类地域聚落：北方的礼治秩序、江南的人情与契约、客家的同心围屋、云岭的歌与榔规。</p>
      <div class="vilgrid">${vilCards}</div>
    </section>
    <footer class="foot">引文均逐字取自《乡土中国》底本存档（见设置页考据说明）· 离线引擎默认，可在设置页接入大模型 API<br/><a href="教程.html">项目教程（这个站是怎么搭的）</a> · <a href="https://github.com/dingdjfjs-star/xiangtu-surveyor">GitHub 仓库</a></footer>`;
  }

  /* ---------- 视图：章节详情 ---------- */
  function viewBook(chId) {
    const c = BOOK.chapter(chId);
    if (!c) return '<p class="empty">章节不存在。</p>';
    const read = state.chapters[c.id] && state.chapters[c.id].read;
    const vil = VILLAGES.village(c.village);
    const tagLabel = { a: '立论', b: '喻证', c: '空间', d: '结论' };
    const concepts = c.concepts.map(x => `<div class="conc"><div class="conc-name">${esc(x.name)}</div><div class="conc-def">${esc(x.def)}</div></div>`).join('');
    const excerpts = c.excerpts.map((e, i) => {
      const noteKey = c.id + '#' + i;
      const note = E.noteOf(state, noteKey);
      return `<blockquote class="excerpt"><span class="extag">${tagLabel[e.tag] || '原文'}</span>${esc(e.text)}<details class="notebox"${note ? ' open' : ''}><summary>我的批注${note ? ' · 已有' : '（可选，将汇入报告）'}</summary><textarea class="note-text" data-notekey="${noteKey}" maxlength="500" placeholder="批读一句话：这段在村子里对应什么现象？（500 字内）">${esc(note)}</textarea><div class="action-row"><button class="btn sm save-note">保存批注</button></div></details></blockquote>`;
    }).join('');
    const tasks = c.tasks.map((t, i) => `<li><b>任务${i + 1}</b> ${esc(t.q)} <span class="hint">${esc(t.hint || '')}</span></li>`).join('');
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead">
      <h1>第${c.no}章 · ${esc(c.title)} <span class="chtheme">${esc(c.theme)}</span></h1>
      <p class="geo-chip">对应地理模块：${esc(c.geo)}</p>
    </header>
    <section class="sec"><h2>导读</h2><p>${esc(c.guide)}</p></section>
    <section class="sec"><h2>核心概念</h2><div class="concgrid">${concepts}</div></section>
    <section class="sec"><h2>原文节选（可回查底本）</h2>${excerpts}</section>
    <section class="sec"><h2>探究任务</h2><ul class="tasks">${tasks}</ul></section>
    <section class="sec action-row">
      <button class="btn primary" id="mark-read" ${read ? 'disabled' : ''}>${read ? '✓ 本章已读毕' : '标记本章读毕（积分+5）'}</button>
      <a class="btn" href="#/village/${vil.id}">前往对口村落「${esc(vil.name)}」驻村 →</a>
    </section>`;
  }

  /* ---------- 视图：驻村总览 ---------- */
  function viewVillage(vId) {
    const v = VILLAGES.village(vId);
    if (!v) return '<p class="empty">村落不存在。</p>';
    E.visit(state, v.id); checkAch();
    const vs = state.villages[v.id];
    const obsN = Object.keys(vs.features || {}).length;
    const matN = Object.keys(vs.talks || {}).reduce((n, k) => n + vs.talks[k].materials.length, 0);
    const g = v.geoFacts;
    const npcCards = v.npcs.map(n => `<div class="npccard"><div class="npc-name">${esc(n.name)}</div><div class="npc-role">${esc(n.role)} · ${n.age} 岁</div><div class="npc-knows">${esc(n.knows)}</div><a class="btn sm" href="#/village/${v.id}/talk?npc=${n.id}">去访谈</a></div>`).join('');
    const findList = v.finds.map(d => {
      const found = vs.finds && vs.finds[d.id];
      return `<div class="find ${found ? 'on' : ''}"><b>${esc(d.name)}</b>${found ? ' — ' + esc(d.desc) : ' （待发现）'}</div>`;
    }).join('');
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead">
      <h1>${esc(v.name)} <span class="chtheme">${esc(v.type)}</span></h1>
      <p class="geo-chip">${esc(v.region)}</p>
      <div class="progress-chips">
        <span class="chip">空间观察 ${obsN}/${v.features.length}</span>
        <span class="chip">素材 ${matN} 条</span>
        <span class="chip">分析 ${vs.analysis ? vs.analysis.score + ' 分' : '未运行'}</span>
        <span class="chip">报告 ${vs.report && vs.report.submitted ? '已交' : '未交'}</span>
      </div>
    </header>
    <nav class="tabs">
      <a class="on" href="#/village/${v.id}">村落档案</a>
      <a href="#/village/${v.id}/map">空间观察</a>
      <a href="#/village/${v.id}/talk">村民访谈</a>
      <a href="#/village/${v.id}/analyze">语义分析</a>
      <a href="#/village/${v.id}/report">考察报告</a>
    </nav>
    <section class="sec"><h2>村落平面（手绘鸟瞰）</h2>${drawMap(v, state, false)}${mapLegendHtml()}</section>
    <section class="sec"><h2>地理背景</h2><p>${esc(v.intro)}</p>
      <table class="gtab"><tr><th>地形</th><td>${esc(g.landform)}</td></tr>
      <tr><th>气候</th><td>${esc(g.climate)}</td></tr>
      <tr><th>农业</th><td>${esc(g.agriculture)}</td></tr>
      <tr><th>生计</th><td>${esc(g.livelihood)}</td></tr>
      <tr><th>交通</th><td>${esc(g.transport)}</td></tr></table>
    </section>
    <section class="sec"><h2>可访谈的村民（${v.npcs.length} 位）</h2><div class="npcgrid">${npcCards}</div></section>
    <section class="sec"><h2>待发现的地理"发现"</h2><div class="findlist">${findList}</div></section>`;
  }

  /* ---------- 视图：空间观察 ---------- */
  function viewMap(vId, focusFid) {
    const v = VILLAGES.village(vId);
    if (!v) return '<p class="empty">村落不存在。</p>';
    E.visit(state, v.id); checkAch();
    const pool = chConceptPool(v);
    const poolChips = pool.map(cid => {
      const cc = BOOK.concept(cid);
      return `<label class="tagpick"><input type="checkbox" value="${cid}"/> ${esc(cc.concept.name)}<span class="tagfrom">${esc(cc.chapter.title)}</span></label>`;
    }).join('');
    const done = v.features.filter(f => {
      const fs = state.villages[v.id].features[f.id];
      return fs && (fs.seen || (fs.myTags || []).length);
    }).length;
    return `
    <div class="crumb"><a href="#/village/${vId}">← ${esc(v.name)}档案</a></div>
    <header class="pagehead"><h1>空间观察 · ${esc(v.name)}</h1>
      <p class="sec-sub">点图上的要素看说明并答观察题；再给它贴概念标签（可选 1-3 个，贴完与真值对照）。</p>
      <div class="progress-chips"><span class="chip">进度 ${done}/${v.features.length}</span></div>
    </header>
    <div class="mapwrap">
      <div class="mapbox" id="mapbox">${drawMap(v, state, true)}${mapLegendHtml()}</div>
      <aside class="sidepanel" id="fpanel"><p class="empty">点选图上任意要素开始观察。</p></aside>
    </div>
    <section class="sec"><h2>概念标签池（本村对口章节）</h2><div class="taggrid">${poolChips}</div></section>`;
  }
  function bindMap(vId) {
    const v = VILLAGES.village(vId);
    const box = document.getElementById('mapbox');
    if (!box) return;
    box.addEventListener('click', ev => {
      const g = ev.target.closest('[data-fid]');
      if (g) openFeature(v, g.getAttribute('data-fid'));
    });
  }
  function openFeature(v, fid) {
    const f = VILLAGES.feature(v.id, fid);
    if (!f) return;
    const fs = E.featureState(state, v.id, fid);
    const cc = BOOK.concept;
    const truthTxt = (f.truth || []).map(t => E.conceptName(BOOK, t)).join('、');
    const askHtml = f.ask ? `
      <div class="ask"><b>观察题</b>：${esc(f.ask.q)}</div>
      <div class="opts">${f.ask.options.map((o, i) => `<label class="opt"><input type="radio" name="askopt" value="${i}"/> ${esc(o)}</label>`).join('')}
      <button class="btn sm primary" id="ask-submit">提交观察</button></div>` : '';
    const tagHtml = `
      <div class="ask"><b>概念标注</b>（勾选后保存，对照真值：<b>${esc(truthTxt)}</b>）</div>
      <div class="tagrow">
        ${chConceptPool(v).map(cid => {
          const on = fs.myTags.indexOf(cid) >= 0;
          return `<label class="tagpick sm"><input type="checkbox" value="${cid}" ${on ? 'checked' : ''}/> ${esc(E.conceptName(BOOK, cid))}</label>`;
        }).join('')}
      </div>
      <button class="btn sm" id="tag-save">保存标注（积分+1）</button>`;
    document.getElementById('fpanel').innerHTML = `
      <h3>${esc(f.name)}</h3>
      <p class="fnote">${esc(f.note)}</p>
      ${fs.askOk === 1 ? '<p class="okline">✓ 观察题已答对</p>' : fs.askOk === 0 && fs.seen ? '<p class="badline">观察题上次答错，可重试。</p>' : ''}
      ${askHtml}
      ${tagHtml}`;
    const sub = document.getElementById('ask-submit');
    if (sub) sub.addEventListener('click', () => {
      const checked = document.querySelector('input[name="askopt"]:checked');
      if (!checked) { toast('先选一个答案'); return; }
      const r = E.observe(state, v.id, f, parseInt(checked.value, 10));
      save(); checkAch();
      document.getElementById('ask-result') && document.getElementById('ask-result').remove();
      const div = document.createElement('div');
      div.className = 'ask-result ' + (r.ok ? 'ok' : 'bad');
      div.id = 'ask-result';
      div.innerHTML = (r.ok ? '<b>✓ 判断正确</b>　' : '<b>✗ 再想想</b>　') + esc(r.exp || '');
      sub.parentElement.appendChild(div);
      if (r.ok) toast('观察正确，积分 +2');
      refreshMapSeen(v.id, fid);
    });
    const tg = document.getElementById('tag-save');
    if (tg) tg.addEventListener('click', () => {
      const chosen = Array.from(document.querySelectorAll('.sidepanel .tagpick input:checked')).map(x => x.value);
      E.tagFeature(state, v.id, f, chosen, chConceptPool(v));
      save(); checkAch();
      toast('标注已保存，去"语义分析"页看对照结果');
      refreshMapSeen(v.id, fid);
    });
  }
  function refreshMapSeen(vId, fid) {
    const box = document.getElementById('mapbox');
    if (!box) return;
    const g = box.querySelector('[data-fid="' + fid + '"]');
    if (g) g.classList.add('seen');
  }

  /* ---------- 视图：访谈 ---------- */
  function viewTalk(vId, presetNpc) {
    const v = VILLAGES.village(vId);
    if (!v) return '<p class="empty">村落不存在。</p>';
    E.visit(state, v.id);
    const cur = presetNpc || v.npcs[0].id;
    const npcTabs = v.npcs.map(n => `<button class="npctab ${n.id === cur ? 'on' : ''}" data-npc="${n.id}">${esc(n.name)}<span>${esc(n.role)}</span></button>`).join('');
    const apiOn = state.settings.api && state.settings.api.enabled;
    return `
    <div class="crumb"><a href="#/village/${vId}">← ${esc(v.name)}档案</a></div>
    <header class="pagehead"><h1>村民访谈 · ${esc(v.name)}</h1>
      <p class="sec-sub">自由提问；回答可"收进素材库"（自动贴概念标签）。不同身份的村民，答案与立场都不同——多方求证才算好田野。</p>
      <p class="modebadge">${apiOn ? '模式：已接入 API（失败自动回落离线）' : '模式：离线引擎（设置页可接大模型 API）'}</p>
    </header>
    <div class="npctabs">${npcTabs}</div>
    <div class="chatwrap">
      <div class="chatlog" id="chatlog"></div>
      <div class="chatbar">
        <input id="chatin" type="text" placeholder="向这位村民提问…（回车发送）" maxlength="120"/>
        <button class="btn primary" id="chatsend">提问</button>
      </div>
    </div>
    <section class="sec"><h2>素材库（本村）</h2><div id="matlist">${matListHtml(vId)}</div></section>`;
  }
  function matListHtml(vId) {
    const vs = state.villages[vId];
    const mats = Object.keys(vs.talks || {}).flatMap(k => vs.talks[k].materials);
    if (!mats.length) return '<p class="empty">素材库还空着——去和村民聊聊吧。</p>';
    return mats.slice().reverse().map(m => {
      const noteKey = 'mat:' + m.id;
      const note = E.noteOf(state, noteKey);
      return `<div class="mat"><div class="mat-meta">${esc(m.npcName)}·${esc(m.role)} <span class="chip ghost sm">${m.tags.map(t => esc(E.conceptName(BOOK, t))).join('、') || '未标概念'}</span></div><div class="mat-text">${esc(m.text)}</div><details class="notebox"${note ? ' open' : ''}><summary>评语${note ? ' · 已有' : ''}</summary><textarea class="note-text" data-notekey="${noteKey}" maxlength="500" placeholder="给这条素材写句评语（可选）">${esc(note)}</textarea><div class="action-row"><button class="btn sm save-note">保存评语</button></div></details></div>`;
    }).join('');
  }
  function bindTalk(vId, presetNpc) {
    const v = VILLAGES.village(vId);
    if (!v) return;
    let curNpc = presetNpc && v.npcs.find(n => n.id === presetNpc) ? presetNpc : v.npcs[0].id;
    const logEl = document.getElementById('chatlog');
    function renderNpcTabs() {
      document.querySelectorAll('.npctab').forEach(b => b.classList.toggle('on', b.getAttribute('data-npc') === curNpc));
    }
    function npcIntro(n) {
      logEl.appendChild(bubble('npc', esc(n.hello), 'persona：' + esc(n.persona)));
    }
    npcIntro(v.npcs.find(n => n.id === curNpc));
    async function send() {
      const input = document.getElementById('chatin');
      const q = (input.value || '').trim();
      if (!q) return;
      input.value = '';
      logEl.appendChild(bubble('me', esc(q)));
      const npc = v.npcs.find(n => n.id === curNpc);
      let ans = null, mode = '离线引擎';
      const api = state.settings.api;
      if (api && api.enabled && api.url && api.key) {
        try { ans = await remoteAsk(v, npc, q); mode = 'API·' + (api.model || 'model'); }
        catch (e) { ans = null; mode = 'API 失败→离线回落'; }
      }
      if (!ans) { ans = E.askNpc(npc, q); mode = '离线引擎'; }
      const tagsHtml = ans.tags && ans.tags.length ? `<span class="chip ghost sm">自动标注：${ans.tags.map(t => esc(E.conceptName(BOOK, t))).join('、')}</span>` : '';
      const followHtml = (ans.follow || []).map(fq => `<button class="btn sm ghost follow" data-q="${esc(fq)}">${esc(fq)}</button>`).join('');
      const collectHtml = ans.isFallback ? '' : `<button class="btn sm collect">收进素材库</button>`;
      const node = bubble('npc', esc(ans.text) + `<div class="ansmeta">${mode === '离线引擎' ? '' : '<span class="chip ghost sm">' + esc(mode) + '</span>'} ${tagsHtml} ${collectHtml} ${followHtml}</div>`);
      logEl.appendChild(node);
      if (!ans.isFallback) {
        node.querySelector('.collect').addEventListener('click', () => {
          const m = E.collectMaterial(state, v.id, npc, ans);
          save(); checkAch();
          toast(m ? '已收进素材库（积分+1）' : '素材库已满或该村民素材已够');
          const ml = document.getElementById('matlist');
          if (ml) ml.innerHTML = matListHtml(vId);
        });
      }
      node.querySelectorAll('.follow').forEach(b => b.addEventListener('click', () => {
        document.getElementById('chatin').value = b.getAttribute('data-q');
        document.getElementById('chatin').focus();
      }));
      logEl.scrollTop = logEl.scrollHeight;
      if (!ans.isFallback) {
        const t = (state.villages[v.id].talks || {})[npc.id];
        if (t && t.turns % 3 === 0) toast(npc.name + '的素材已 ' + t.materials.length + ' 条');
      }
    }
    document.getElementById('chatsend').addEventListener('click', send);
    document.getElementById('chatin').addEventListener('keydown', ev => { if (ev.key === 'Enter') send(); });
    document.querySelectorAll('.npctab').forEach(b => b.addEventListener('click', () => {
      curNpc = b.getAttribute('data-npc');
      renderNpcTabs();
      logEl.innerHTML = '';
      npcIntro(v.npcs.find(n => n.id === curNpc));
    }));
  }
  function bubble(who, html, sub) {
    const d = document.createElement('div');
    d.className = 'bub ' + who;
    d.innerHTML = `<div class="bub-text">${html}</div>${sub ? '<div class="bub-sub">' + sub + '</div>' : ''}`;
    return d;
  }
  async function remoteAsk(v, npc, q) {
    const api = state.settings.api;
    const concepts = chConceptPool(v).map(cid => { const cc = BOOK.concept(cid); return { id: cid, name: cc.concept.name, def: cc.concept.def }; });
    const sys = PR.PROMPTS.npcTalk.text
      .replace('{ROLE_JSON}', JSON.stringify({ name: npc.name, role: npc.role, age: npc.age, persona: npc.persona, knows: npc.knows, blind: npc.blind }))
      .replace('{VILLAGE_INTRO}', v.intro)
      .replace('{CONCEPTS_JSON}', JSON.stringify(concepts))
      .replace('{HISTORY_JSON}', '[]')
      .replace('{QUESTION}', q);
    const res = await fetch(api.url.replace(/\/$/, '') + '/chat/completions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + api.key },
      body: JSON.stringify({ model: api.model || 'glm-4-flash', messages: [{ role: 'user', content: sys }], temperature: 0.6 })
    });
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const j = await res.json();
    const txt = j.choices && j.choices[0] && j.choices[0].message && j.choices[0].message.content || '';
    const mjson = txt.match(/\{[\s\S]*\}/);
    if (mjson) {
      try {
        const p = JSON.parse(mjson[0]);
        return { text: String(p.text || txt).slice(0, 400), tags: p.concept ? [p.concept] : [], isFallback: false, follow: (p.follow || []).slice(0, 2) };
      } catch (e) { /* fallthrough */ }
    }
    return { text: txt.slice(0, 400), tags: [], isFallback: false, follow: [] };
  }

  /* ---------- 视图：语义分析 ---------- */
  function viewAnalyze(vId) {
    const v = VILLAGES.village(vId);
    if (!v) return '<p class="empty">村落不存在。</p>';
    const vs = state.villages[v.id];
    const an = vs.analysis;
    const rowsHtml = an ? an.rows.map(r => `
      <tr class="${r.ok ? 'ok' : ''}">
        <td>${esc(r.name)}</td>
        <td>${r.mine.length ? r.mine.map(t => esc(E.conceptName(BOOK, t))).join('、') : '<i>未标注</i>'}</td>
        <td>${r.truth.map(t => esc(E.conceptName(BOOK, t))).join('、')}</td>
        <td>${r.full ? '◎ 全对' : r.ok ? '○ 部分命中' : '✗ 不符'}</td>
      </tr>`).join('') : '';
    const finds = (v.finds || []).map(d => {
      const found = vs.finds && vs.finds[d.id] || (an && an.finds.indexOf(d.id) >= 0);
      return `<div class="find ${found ? 'on' : ''}"><b>${esc(d.name)}</b>（对应概念：${esc(E.conceptName(BOOK, d.concept))}）${found ? '<br/>' + esc(d.desc) : ' — 满分标注对应要素后自动点亮'}</div>`;
    }).join('');
    return `
    <div class="crumb"><a href="#/village/${vId}">← ${esc(v.name)}档案</a></div>
    <header class="pagehead"><h1>空间语义分析 · ${esc(v.name)}</h1>
      <p class="sec-sub">把你在图上贴的概念标签与每处要素的真值对照——这是"空间特征 × 社科概念"的对应表。</p>
    </header>
    <section class="sec action-row">
      <button class="btn primary" id="run-analyze">运行分析（对照真值）</button>
      ${an ? `<span class="score-ring">${an.score}<small>分</small></span>` : ''}
    </section>
    ${an ? `<section class="sec"><h2>概念-空间对照表（${an.rows.length} 项）</h2>
      <table class="atab"><tr><th>要素</th><th>我的标注</th><th>真值</th><th>判定</th></tr>${rowsHtml}</table>
      <p class="hint">判定口径：命中任一真值概念＝○；与真值完全一致（数量也一致）＝◎。</p></section>` : '<section class="sec"><p class="empty">先在"空间观察"页完成观察与标注。</p></section>'}
    <section class="sec"><h2>地理"发现"</h2>${finds}</section>`;
  }
  function bindAnalyze(vId) {
    const v = VILLAGES.village(vId);
    if (!v) return;
    const btn = document.getElementById('run-analyze');
    if (btn) btn.addEventListener('click', () => {
      E.analyzeVillage(state, v.id, v, chConceptPool(v));
      save(); checkAch();
      const an = state.villages[v.id].analysis;
      toast('分析完成：' + an.score + ' 分');
      render();
    });
  }

  /* ---------- 视图：考察报告 ---------- */
  function viewReport(vId) {
    const v = VILLAGES.village(vId);
    if (!v) return '<p class="empty">村落不存在。</p>';
    const vs = state.villages[v.id];
    const sub = vs.report && vs.report.submitted;
    return `
    <div class="crumb"><a href="#/village/${vId}">← ${esc(v.name)}档案</a></div>
    <header class="pagehead"><h1>考察报告工作台 · ${esc(v.name)}</h1>
      <p class="sec-sub">离线生成器只做"素材结构化重组"，不虚构任何事实；初稿可编辑，提交后自动初评。</p>
    </header>
    <section class="sec"><h2>素材库</h2><div id="matlist">${matListHtml(vId)}</div></section>
    <section class="sec action-row">
      <button class="btn primary" id="gen-report">由素材生成报告初稿</button>
      <button class="btn" id="export-report">导出 Markdown</button>
      <button class="btn" id="print-report">打印 / PDF</button>
      ${sub ? `<span class="chip ok">已提交 · 初评 ${sub.grade.score} 分</span>` : ''}
    </section>
    <section class="sec"><h2>报告正文（可编辑）</h2>
      <textarea id="report-text" rows="18" placeholder="点击上方按钮生成初稿，或直接撰写……">${esc(vs.report.text || '')}</textarea>
      <div class="action-row">
        <button class="btn" id="grade-report">保存并初评</button>
        <button class="btn primary" id="submit-report">提交报告</button>
      </div>
      <div id="gradebox"></div>
    </section>`;
  }
  function bindReport(vId) {
    const v = VILLAGES.village(vId);
    if (!v) return;
    const gen = document.getElementById('gen-report');
    if (gen) gen.addEventListener('click', () => {
      const r = E.buildReport(state, v.id, v, BOOK);
      document.getElementById('report-text').value = r.plain;
      toast('初稿已生成——请务必自己改过再交');
    });
    const gr = document.getElementById('grade-report');
    if (gr) gr.addEventListener('click', () => {
      const t = document.getElementById('report-text').value;
      state.villages[v.id].report.text = t;
      const g = E.gradeReport(state, v.id, t, v, BOOK);
      save();
      document.getElementById('gradebox').innerHTML = gradeBoxHtml(g);
    });
    const exp = document.getElementById('export-report');
    if (exp) exp.addEventListener('click', () => {
      const t = document.getElementById('report-text').value;
      if (!t.trim()) { toast('报告正文还是空的'); return; }
      const sub = state.villages[v.id].report && state.villages[v.id].report.submitted;
      const md = ['# 《乡土中国》田野考察报告',
        '- 村落：' + v.name + '（' + v.type + ' · ' + v.region + '）',
        '- 调查员：' + (state.student.name || '无名调查员'),
        '- 日期：' + new Date().toISOString().slice(0, 10),
        sub ? '- 初评：' + sub.grade.score + ' 分' : '- 初评：未提交',
        '', t, '',
        '> 生成自「乡土调查员」· 《乡土中国》田野探究工作坊'].join('\n');
      downloadText('乡土考察报告-' + v.name + '.md', md);
      toast('已导出 Markdown 文件');
    });
    const pr = document.getElementById('print-report');
    if (pr) pr.addEventListener('click', () => {
      const t = document.getElementById('report-text').value;
      if (!t.trim()) { toast('报告正文还是空的'); return; }
      const lines = ['村落：' + v.name + '（' + v.type + ' · ' + v.region + '）',
        '调查员：' + (state.student.name || '无名调查员') + ' · ' + new Date().toISOString().slice(0, 10),
        ''].concat(t.split('\n'));
      printSheet('《乡土中国》田野考察报告 · ' + v.name, lines);
    });
    const sb = document.getElementById('submit-report');
    if (sb) sb.addEventListener('click', () => {
      const t = document.getElementById('report-text').value;
      if (t.replace(/\s/g, '').length < 100) { toast('正文太短，先写满 100 字再交'); return; }
      const g = E.submitReport(state, v.id, t, v, BOOK);
      save(); checkAch();
      document.getElementById('gradebox').innerHTML = gradeBoxHtml(g);
      // 就地更新提交状态，避免整体重渲染吞掉评分反馈
      const gen = document.getElementById('gen-report');
      if (gen && !gen.parentElement.querySelector('.chip.ok')) {
        const chip = document.createElement('span');
        chip.className = 'chip ok';
        chip.textContent = '已提交 · 初评 ' + g.score + ' 分';
        gen.parentElement.appendChild(chip);
      }
      toast('报告已提交：初评 ' + g.score + ' 分');
    });
  }
  function gradeBoxHtml(g) {
    return `<div class="gradebox"><div class="grade-score">初评 ${g.score} 分 ${'★'.repeat(g.stars)}${'☆'.repeat(3 - g.stars)}</div>
      <ul>${g.advice.map(a => '<li>' + esc(a) + '</li>').join('') || '<li>各项达标，可以提交给老师终审。</li>'}</ul></div>`;
  }

  /* ---------- 视图：区域对比 ---------- */
  function viewCompare() {
    const opt = (v, sel) => `<option value="${v.id}" ${sel ? 'selected' : ''}>${esc(v.name)}（${esc(v.type)}）</option>`;
    const optsA = VILLAGES.VILLAGES.map(v => opt(v, v.id === 'v1')).join('');
    const optsB = VILLAGES.VILLAGES.map(v => opt(v, v.id === 'v2')).join('');
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead"><h1>区域对比 · 差异表</h1>
      <p class="sec-sub">任意两村横向对照：地理背景、聚落形态、权力空间、交换空间——地理差异如何长出社会差异。</p>
    </header>
    <section class="sec action-row">
      <select id="cmpA">${optsA}</select>
      <select id="cmpB">${optsB}</select>
      <button class="btn primary" id="cmpGo">生成对比</button>
    </section>
    <section class="sec" id="cmpOut"><p class="empty">选两个村落，点"生成对比"。</p></section>`;
  }
  function bindCompare() {
    const btn = document.getElementById('cmpGo');
    if (!btn) return;
    btn.addEventListener('click', () => {
      const a = document.getElementById('cmpA').value, b = document.getElementById('cmpB').value;
      if (a === b) { toast('选两个不同的村落'); return; }
      const vA = VILLAGES.village(a), vB = VILLAGES.village(b);
      const rows = E.compareVillages(vA, vB, state, BOOK);
      save(); checkAch();
      document.getElementById('cmpOut').innerHTML = `<table class="ctab"><tr><th>维度</th><th>${esc(vA.name)}</th><th>${esc(vB.name)}</th></tr>
        ${rows.map(r => `<tr><th>${esc(r.dim)}</th><td>${esc(r.a)}</td><td>${esc(r.b)}</td></tr>`).join('')}</table>
        <div class="action-row"><button class="btn sm" id="cmpExport">导出对比 Markdown</button></div>
        <p class="hint">对比完成（积分+4）。试着回答：同一概念（如"算账"的规矩）在两村的空间证据有何不同？</p>`;
      const cx = document.getElementById('cmpExport');
      if (cx) cx.addEventListener('click', () => {
        const md = ['# 区域差异对比：' + vA.name + ' × ' + vB.name, '',
          '| 维度 | ' + vA.name + ' | ' + vB.name + ' |', '|---|---|---|',
          rows.map(r => '| ' + r.dim + ' | ' + String(r.a).replace(/\|/g, '／') + ' | ' + String(r.b).replace(/\|/g, '／') + ' |').join('\n'),
          '', '> 生成自「乡土调查员」· ' + new Date().toISOString().slice(0, 10)].join('\n');
        downloadText('区域对比-' + vA.name + '-' + vB.name + '.md', md);
        toast('已导出对比表');
      });
    });
  }

  /* ---------- 视图：成就 ---------- */
  function viewAch() {
    const lvl = E.levelOf(state.points);
    const next = E.LEVELS.find(l => l.min > state.points);
    const achs = E.ACHIEVEMENTS.map(a => {
      const got = state.achievements.indexOf(a.id) >= 0;
      return `<div class="ach ${got ? 'on' : ''}"><div class="ach-name">${esc(a.name)}</div><div class="ach-desc">${esc(a.desc)}</div></div>`;
    }).join('');
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead"><h1>调查员等级与成就</h1></header>
    <section class="sec">
      <div class="lvlbar"><div class="lvl-fill" style="width:${next ? Math.min(100, Math.round(100 * (state.points - lvl.min) / (next.min - lvl.min))) : 100}%"></div></div>
      <p><b>${esc(lvl.name)}</b> · ${state.points} 分 ${next ? '（距「' + esc(next.name) + '」还差 ' + (next.min - state.points) + ' 分）' : '（已达最高称号）'}</p>
      <p class="hint">称号阶梯：${E.LEVELS.map(l => esc(l.name) + ' ' + l.min).join(' → ')}</p>
    </section>
    <section class="sec"><h2>成就图鉴（${state.achievements.length}/${E.ACHIEVEMENTS.length}）</h2><div class="achgrid">${achs}</div></section>`;
  }

  /* ---------- 视图：教师端 ---------- */
  function viewTeacher() {
    const tab = parseRoute()[1] || 'dash';
    const tabs = [
      ['dash', '学情看板'], ['tasks', '任务发布'], ['review', '报告评阅'], ['collection', '优秀成果集']
    ].map(t => `<a class="${tab === t[0] ? 'on' : ''}" href="#/teacher/${t[0]}">${t[1]}</a>`).join('');
    let body = '';
    if (tab === 'dash') body = teacherDash();
    else if (tab === 'tasks') body = teacherTasks();
    else if (tab === 'review') body = teacherReview();
    else body = teacherCollection();
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead"><h1>教师端 · 探究教学管理工作台</h1></header>
    <nav class="tabs">${tabs}</nav>${body}`;
  }
  function teacherDash() {
    const cls = E.demoClass('default');
    const rows = cls.students.map(s => `<tr><td>${esc(s.name)}</td><td>${s.chapters}/14</td><td>${s.talkTurns}</td><td>${s.observeScore}</td><td>${s.reportScore >= 0 ? s.reportScore : '未交'}</td><td class="mis">${esc(s.misconception)}</td></tr>`).join('');
    const a = cls.agg;
    return `
    <section class="sec"><p class="demo-note">※ 以下为种子生成的<b>模拟演示数据</b>（种子 ${esc(String(cls.seed))}），仅展示看板形态；接入真实班级后此区由学生端数据填充。</p>
      <div class="kpis">
        <div class="kpi"><b>${a.avgChapters}</b><span>人均读毕章节</span></div>
        <div class="kpi"><b>${a.avgTalks}</b><span>人均访谈轮次</span></div>
        <div class="kpi"><b>${a.avgObserve}</b><span>平均观察得分</span></div>
        <div class="kpi"><b>${a.avgReport}</b><span>平均报告分（${a.submitted} 人提交）</span></div>
      </div>
      <table class="atab"><tr><th>学生</th><th>读章</th><th>访谈轮次</th><th>观察分</th><th>报告分</th><th>常见误区（模拟）</th></tr>${rows}</table>
      <p class="hint">全班最高频误区：${esc(a.misconceptionTop.m)}（${a.misconceptionTop.n} 人）——建议以此做一次 5 分钟全班讲评。</p>
    </section>`;
  }
  function teacherTasks() {
    const opts = BOOK.CHAPTERS.map(c => `<option value="${c.id}">第${c.no}章 ${esc(c.title)}</option>`).join('');
    const tasks = state.tasks.slice().reverse().map(t => {
      const c = BOOK.chapter(t.chId);
      return `<div class="task"><b>《${esc(c ? c.title : t.chId)}》探究任务</b>　截止：${esc(t.deadline || '不限')}　评价标准：${esc(t.criteria || '初评 ≥70')}<br/><span class="hint">发布于 ${esc(t.at.slice(0, 10))}</span></div>`;
    }).join('');
    return `
    <section class="sec"><h2>发布探究任务</h2>
      <div class="formrow"><label>章节</label><select id="task-ch">${opts}</select></div>
      <div class="formrow"><label>截止时间</label><input id="task-dl" type="date"/></div>
      <div class="formrow"><label>评价标准</label><input id="task-crit" type="text" placeholder="如：初评≥70 且引用原文≥1处" maxlength="60"/></div>
      <button class="btn primary" id="task-add">发布任务</button>
      <div id="tasklist">${tasks || '<p class="empty">还没有发布任务。</p>'}</div>
    </section>`;
  }
  function teacherReview() {
    const subs = [];
    VILLAGES.VILLAGES.forEach(v => {
      const vs = state.villages[v.id];
      if (vs && vs.report && vs.report.submitted) subs.push({ v: v, r: vs.report.submitted });
    });
    if (!subs.length) return '<section class="sec"><p class="empty">学生端还没有提交报告（当前浏览器即学生端——去学生端交一份，这里就能看到）。</p></section>';
    return `<section class="sec">${subs.map(s => `
      <div class="review">
        <div class="review-head"><b>${esc(s.v.name)} 考察报告</b> · AI 初评 ${s.r.grade.score} 分 ${'★'.repeat(s.r.grade.stars)} ${s.r.verdict ? '<span class="chip ' + (s.r.verdict === '优秀' ? 'ok' : 'bad') + '">' + esc(s.r.verdict) + '</span>' : '<span class="chip ghost">待终审</span>'}</div>
        <details><summary>展开正文</summary><pre class="reportpre">${esc(s.r.text)}</pre></details>
        <div class="action-row">
          <input type="text" class="verdict-in" placeholder="终审意见（如：建议补一笔'评理'的观察）" maxlength="60"/>
          <button class="btn sm primary verdict-ok">评为优秀</button>
          <button class="btn sm verdict-back">打回修改</button>
        </div>
      </div>`).join('')}</section>`;
  }
  function teacherCollection() {
    const items = [];
    VILLAGES.VILLAGES.forEach(v => {
      const vs = state.villages[v.id];
      if (vs && vs.report && vs.report.submitted && vs.report.submitted.verdict === '优秀') items.push({ v: v, r: vs.report.submitted });
    });
    if (!items.length) return '<section class="sec"><p class="empty">评阅为"优秀"的报告会自动进入成果集。</p></section>';
    return `<section class="sec">${items.map(s => `<div class="review"><div class="review-head"><b>${esc(s.v.name)}</b> · ${s.r.grade.score} 分</div><pre class="reportpre">${esc(s.r.text)}</pre></div>`).join('')}</section>`;
  }
  function bindTeacher() {
    const tab = parseRoute()[1] || 'dash';
    if (tab === 'tasks') {
      const btn = document.getElementById('task-add');
      if (btn) btn.addEventListener('click', () => {
        const chId = document.getElementById('task-ch').value;
        const dl = document.getElementById('task-dl').value;
        const crit = document.getElementById('task-crit').value.trim();
        state.tasks.push({ id: 't' + (state.seq++), chId: chId, deadline: dl, criteria: crit, at: new Date().toISOString() });
        save(); toast('任务已发布'); render();
      });
    }
    if (tab === 'review') {
      document.querySelectorAll('.review').forEach((div, idx) => {
        const ok = div.querySelector('.verdict-ok'), back = div.querySelector('.verdict-back'), vin = div.querySelector('.verdict-in');
        const subs = [];
        VILLAGES.VILLAGES.forEach(v => { const vs = state.villages[v.id]; if (vs && vs.report && vs.report.submitted) subs.push(v.id); });
        const vId = subs[idx];
        if (ok) ok.addEventListener('click', () => {
          state.villages[vId].report.submitted.verdict = '优秀';
          state.villages[vId].report.submitted.verdictNote = vin.value.trim();
          save(); checkAch(); toast('已评为优秀，进入成果集'); render();
        });
        if (back) back.addEventListener('click', () => {
          state.villages[vId].report.submitted.verdict = '打回';
          state.villages[vId].report.submitted.verdictNote = vin.value.trim();
          save(); toast('已打回，学生端可见终审意见'); render();
        });
      });
    }
  }

  /* ---------- 视图：设置 ---------- */
  function viewSettings() {
    const api = state.settings.api;
    const promptCards = Object.keys(PR.PROMPTS).map(k => {
      const p = PR.PROMPTS[k];
      return `<div class="promptcard"><div class="prompt-head"><b>${esc(p.name)}</b> <button class="btn sm copy-prompt" data-k="${k}">复制提示词</button></div><p class="hint">${esc(p.desc)}</p><pre class="promptpre">${esc(p.text)}</pre></div>`;
    }).join('');
    return `
    <div class="crumb"><a href="#/">← 返回首页</a></div>
    <header class="pagehead"><h1>设置 · AI 模式 · 考据</h1></header>
    <section class="sec"><h2>大模型 API（可选，默认关闭）</h2>
      <p class="hint">离线引擎默认可用且确定性可测；接入 OpenAI 兼容 API（默认智谱 glm-4-flash）后 NPC 对话与报告润色走大模型，失败自动回落并注明。凭据只存本机浏览器。</p>
      <div class="formrow"><label>接口地址</label><input id="api-url" type="text" placeholder="https://open.bigmodel.cn/api/paas/v4" value="${esc(api.url)}"/></div>
      <div class="formrow"><label>API Key</label><input id="api-key" type="password" placeholder="sk-…" value="${esc(api.key)}"/></div>
      <div class="formrow"><label>模型</label><input id="api-model" type="text" value="${esc(api.model)}"/></div>
      <div class="action-row">
        <button class="btn primary" id="api-save">保存配置</button>
        <button class="btn ${api.enabled ? '' : 'ghost'}" id="api-toggle">${api.enabled ? '✓ 已启用（点击关闭）' : '已禁用（点击启用）'}</button>
      </div>
    </section>
    <section class="sec"><h2>核心 AI 提示词（4 组）</h2>${promptCards}</section>
    <section class="sec"><h2>离线引擎说明</h2><ul>${PR.OFFLINE_NOTES.map(n => '<li>' + esc(n) + '</li>').join('')}</ul></section>
    <section class="sec"><h2>数据管理</h2>
      <div class="action-row">
        <button class="btn" id="exp-data">导出存档（JSON）</button>
        <button class="btn" id="imp-data">导入存档</button>
        <button class="btn ghost" id="clr-data">清空本地存档</button>
      </div>
      <input type="file" id="imp-file" accept=".json" style="display:none"/>
      <p class="hint">存档键：xiangtu1 · 包含全部进度、素材与报告。</p>
    </section>
    <section class="sec"><h2>考据说明</h2>
      <p>本站全部《乡土中国》引文逐字取自底本存档（国学导航版，双源交叉核验过程见 <b>report/考据说明.md</b>）；引文回归测试随 test 套件运行。网络流传"名言"常有拼接改写，引用请以本站原文阅读器为准。</p>
    </section>`;
  }
  function bindSettings() {
    const apiSave = document.getElementById('api-save');
    if (apiSave) apiSave.addEventListener('click', () => {
      state.settings.api.url = document.getElementById('api-url').value.trim();
      state.settings.api.key = document.getElementById('api-key').value.trim();
      state.settings.api.model = document.getElementById('api-model').value.trim() || 'glm-4-flash';
      save(); toast('API 配置已保存（本地）');
    });
    const tg = document.getElementById('api-toggle');
    if (tg) tg.addEventListener('click', () => {
      if (!state.settings.api.url || !state.settings.api.key) { toast('先填接口地址与 Key'); return; }
      state.settings.api.enabled = !state.settings.api.enabled;
      save(); toast(state.settings.api.enabled ? 'API 已启用' : 'API 已关闭'); render();
    });
    document.querySelectorAll('.copy-prompt').forEach(b => b.addEventListener('click', () => {
      const p = PR.PROMPTS[b.getAttribute('data-k')];
      const ta = document.createElement('textarea');
      ta.value = p.text; document.body.appendChild(ta); ta.select();
      try { document.execCommand('copy'); toast('已复制：' + p.name); } catch (e) { toast('复制失败，请手动选择'); }
      ta.remove();
    }));
    const exp = document.getElementById('exp-data');
    if (exp) exp.addEventListener('click', () => {
      const blob = new Blob([E.serialize(state)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'xiangtu-save-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
    });
    const imp = document.getElementById('imp-data');
    if (imp) imp.addEventListener('click', () => document.getElementById('imp-file').click());
    const file = document.getElementById('imp-file');
    if (file) file.addEventListener('change', () => {
      const f = file.files[0];
      if (!f) return;
      const rd = new FileReader();
      rd.onload = () => {
        const s = E.deserialize(rd.result);
        if (!s) { toast('存档格式无效'); return; }
        state = s; save(); toast('存档已导入'); render();
      };
      rd.readAsText(f);
    });
    const clr = document.getElementById('clr-data');
    if (clr) clr.addEventListener('click', () => {
      if (!confirm('确定清空全部本地进度？此操作不可恢复。')) return;
      localStorage.removeItem(LS_KEY); state = E.newState(); save(); toast('已清空'); render();
    });
  }

  /* ---------- 成就刷新 ---------- */
  function checkAch() {
    const got = E.checkAchievements(state);
    if (got.length) save();
    got.forEach(a => toast('成就解锁：' + a.name));
    return got;
  }

  /* ---------- 路由 ---------- */
  function render() {
    const r = parseRoute();
    let html = '';
    let binder = null;
    if (r[0] === '' || r[0] === undefined) { html = viewHome(); }
    else if (r[0] === 'book') { html = viewBook(r[1]); }
    else if (r[0] === 'village') {
      const vId = r[1];
      if (!VILLAGES.village(vId)) html = '<p class="empty">村落不存在。</p>';
      else if (r[2] === 'map') { html = viewMap(vId); binder = () => bindMap(vId); }
      else if (r[2] === 'talk') { html = viewTalk(vId, r.query.npc); binder = () => bindTalk(vId, r.query.npc); }
      else if (r[2] === 'analyze') { html = viewAnalyze(vId); binder = () => bindAnalyze(vId); }
      else if (r[2] === 'report') { html = viewReport(vId); binder = () => bindReport(vId); }
      else html = viewVillage(vId);
    }
    else if (r[0] === 'compare') { html = viewCompare(); binder = bindCompare; }
    else if (r[0] === 'ach') { html = viewAch(); }
    else if (r[0] === 'teacher') { html = viewTeacher(); binder = bindTeacher; }
    else if (r[0] === 'settings') { html = viewSettings(); binder = bindSettings; }
    else html = '<p class="empty">页面不存在。</p>';
    app.innerHTML = html;
    if (binder) binder();
    // 章节读毕按钮
    const mr = document.getElementById('mark-read');
    if (mr && !mr.disabled) mr.addEventListener('click', () => {
      E.readChapter(state, r[1]); save(); checkAch(); toast('读毕标记成功，积分+5'); render();
    });
    // 批注保存（章节节选批注 / 素材评语，通用委托；就地更新，不重渲染以免丢未提交的正文）
    app.querySelectorAll('.save-note').forEach(b => b.addEventListener('click', () => {
      const box = b.closest('.notebox');
      const ta = box && box.querySelector('.note-text');
      if (!ta) return;
      const res = E.setNote(state, ta.getAttribute('data-notekey'), ta.value);
      save(); checkAch();
      const sum = box.querySelector('summary');
      if (sum) {
        const base = sum.textContent.replace(' · 已有', '');
        sum.textContent = ta.value.trim() ? base + ' · 已有' : base;
      }
      toast(res.removed ? '批注已清空' : '批注已保存' + (res.created ? '（积分+1）' : ''));
    }));
    window.scrollTo(0, 0);
  }

  /* ---------- 启动 ---------- */
  load();
  window.addEventListener('hashchange', render);
  render();
  save();
})();
