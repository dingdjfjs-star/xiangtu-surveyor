/* ============================================================
 * 引擎核心（纯逻辑，禁 DOM）：状态机 / NPC 离线对话 / 空间语义分析 /
 * 报告生成与初评 / 成就与等级 / 教师端模拟班级 / 双村对比
 * 纪律：一切函数确定性可测；种子哈希只用输入串；越界一律安全回落。
 * ============================================================ */
(function (global) {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : global;

  /* ---------- 基础工具 ---------- */
  function hash32(str) {
    let h = 2166136261 >>> 0;
    const s = String(str || '');
    for (let i = 0; i < s.length; i++) {
      h ^= s.charCodeAt(i);
      h = Math.imul(h, 16777619) >>> 0;
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return function () {
      a |= 0; a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  function normQ(s) {
    return String(s || '').toLowerCase()
      .replace(/[\s，。、；：？！“”‘’"'\.,;:\?\!()（）\[\]【】\-—·~～]/g, '');
  }
  function nowId(seq) { return 'm' + String(seq).padStart(4, '0'); }
  function clamp(n, a, b) { return Math.max(a, Math.min(b, n)); }

  /* ---------- 状态机 ---------- */
  const STATE_VERSION = 1;

  function newState(name) {
    return {
      version: STATE_VERSION,
      createdAt: new Date().toISOString(),
      student: { name: name || '无名调查员' },
      points: 0,
      seq: 1,
      chapters: {},          // c01: {read:true, at}
      villages: {},          // v1: {visited, features:{}, talks:{}, analysis:{}, report:{}}
      achievements: [],      // 'a01'
      compareDone: [],       // 'v1|v2'
      tasks: [],             // 教师发布 {id, chId, deadline, criteria, at}
      notes: {},             // 学生批注 { 'c01#2': text }（节选批注）/ 'mat:m0003'（素材评语）
      settings: { api: { url: '', key: '', model: 'glm-4-flash', enabled: false } },
      logs: []               // 事件留痕（上限 200）
    };
  }
  function vState(state, vId) {
    if (!state.villages[vId]) state.villages[vId] = { visited: false, features: {}, talks: {}, analysis: null, report: { text: '', submitted: null } };
    return state.villages[vId];
  }
  function log(state, type, detail) {
    state.logs.push({ t: Date.now(), type: type, d: String(detail || '').slice(0, 120) });
    if (state.logs.length > 200) state.logs = state.logs.slice(-200);
  }
  function addPoints(state, n) {
    state.points = Math.max(0, (state.points || 0) + n);
    return state.points;
  }
  function readChapter(state, chId) {
    if (!state.chapters[chId]) {
      state.chapters[chId] = { read: true, at: new Date().toISOString() };
      addPoints(state, 5);
      log(state, 'read', chId);
    }
    return state.chapters[chId];
  }
  function visit(state, vId) {
    const v = vState(state, vId);
    if (!v.visited) { v.visited = true; addPoints(state, 2); log(state, 'visit', vId); }
    return v;
  }

  /* ---------- NPC 离线对话引擎（确定性） ---------- */
  function pickRule(npc, question) {
    const q = normQ(question);
    if (!q) return null;
    let best = null, bestHits = 0;
    for (const r of (npc.rules || [])) {
      let hits = 0;
      for (const kw of (r.kws || [])) {
        const k = normQ(kw);
        if (k && q.indexOf(k) >= 0) hits++;
      }
      if (hits > bestHits) { best = r; bestHits = hits; }
    }
    return best; // 命中数并列时取声明序在前者（严格大于才替换）
  }
  function pickFallback(npc, question) {
    const arr = npc.fallback || ['这个俺答不上来。'];
    const idx = hash32((npc.id || '') + '|' + normQ(question)) % arr.length;
    return arr[idx];
  }
  /**
   * 离线问答。返回 {text, tags, ruleId|null, isFallback, follow}
   */
  function askNpc(npc, question) {
    if (!npc || !npc.id) return { text: '（访谈对象不存在。）', tags: [], ruleId: null, isFallback: true, follow: [] };
    const rule = pickRule(npc, question);
    if (rule) {
      return {
        text: rule.say,
        tags: rule.concept ? [rule.concept] : [],
        ruleId: rule.kws ? rule.kws.join('+') : null,
        isFallback: false,
        follow: (rule.follow || []).slice(0, 2)
      };
    }
    return { text: pickFallback(npc, question), tags: [], ruleId: null, isFallback: true, follow: [] };
  }

  /* ---------- 素材收集 ---------- */
  const MATERIAL_CAP = 80, NPC_MATERIAL_CAP = 20;
  function collectMaterial(state, vId, npc, answer) {
    const v = vState(state, vId);
    if (!v.talks[npc.id]) v.talks[npc.id] = { turns: 0, materials: [], rulesHit: {} };
    const t = v.talks[npc.id];
    t.turns++;
    const total = Object.keys(v.talks).reduce((s, k) => s + v.talks[k].materials.length, 0);
    if (total >= MATERIAL_CAP) return null;
    if (t.materials.length >= NPC_MATERIAL_CAP) return null;
    if (answer.isFallback) return null; // 回落句不采集
    const m = {
      id: nowId(state.seq++),
      npc: npc.id, npcName: npc.name, role: npc.role,
      text: String(answer.text || '').slice(0, 400),
      tags: (answer.tags || []).slice(),
      ruleId: answer.ruleId || null,
      at: new Date().toISOString()
    };
    t.materials.push(m);
    if (answer.ruleId) t.rulesHit[answer.ruleId] = (t.rulesHit[answer.ruleId] || 0) + 1;
    addPoints(state, 1);
    log(state, 'material', m.id + '@' + npc.id);
    return m;
  }
  function reTagMaterial(state, vId, matId, tags) {
    const v = vState(state, vId);
    for (const k of Object.keys(v.talks)) {
      const m = v.talks[k].materials.find(x => x.id === matId);
      if (m) { m.tags = (tags || []).slice(0, 3); return m; }
    }
    return null;
  }

  /* ---------- 空间观察与概念标注 ---------- */
  function featureState(state, vId, fId) {
    const v = vState(state, vId);
    if (!v.features[fId]) v.features[fId] = { seen: false, askOk: 0, myTags: [] };
    return v.features[fId];
  }
  function observe(state, vId, feature, choice) {
    if (!feature || !feature.ask) return { ok: false, exp: '本要素暂无观察题。' };
    const fs = featureState(state, vId, feature.id);
    fs.seen = true;
    fs.askOk = (choice === feature.ask.answer) ? 1 : 0;
    if (fs.askOk) addPoints(state, 2);
    log(state, 'observe', feature.id + '=' + fs.askOk);
    return { ok: fs.askOk === 1, exp: feature.ask.exp };
  }
  function tagFeature(state, vId, feature, conceptIds, pool) {
    const fs = featureState(state, vId, feature.id);
    const clean = (conceptIds || []).filter(c => !pool || pool.indexOf(c) >= 0).slice(0, 3);
    fs.myTags = clean;
    addPoints(state, 1);
    log(state, 'tag', feature.id + ':' + clean.join(','));
    return fs;
  }
  /**
   * 空间语义分析（对照真值，确定性）
   */
  function analyzeVillage(state, vId, village, pool) {
    const v = vState(state, vId);
    const rows = [];
    let taggedRight = 0, askRight = 0, observed = 0, tagged = 0;
    for (const f of village.features) {
      const fs = v.features[f.id];
      if (!fs || (!fs.seen && !(fs.myTags || []).length)) continue;
      observed++;
      const truth = f.truth || [];
      const mine = (fs.myTags || []).filter(c => truth.indexOf(c) >= 0);
      if ((fs.myTags || []).length) tagged++;
      if (mine.length) taggedRight++;
      if (fs.askOk === 1) askRight++;
      rows.push({
        fId: f.id, name: f.name,
        mine: (fs.myTags || []).slice(),
        truth: truth.slice(),
        ok: mine.length > 0,
        full: mine.length === truth.length && truth.length > 0 && fs.myTags.length === truth.length,
        analysis: f.analysis
      });
    }
    const maxA = village.features.length * 2;
    const score = maxA ? Math.round(100 * (taggedRight * 2 + askRight) / maxA) : 0;
    const finds = (village.finds || []).filter(d => {
      const f = village.features.find(x => (x.truth || []).indexOf(d.concept) >= 0 && rows.some(r => r.fId === x.id && r.full));
      return !!f;
    });
    // 发现自动入账（每枚 +3）
    v.finds = v.finds || {};
    finds.forEach(d => {
      const fdId = d.id;
      if (!v.finds[fdId]) { v.finds[fdId] = true; addPoints(state, 3); log(state, 'find', fdId); }
    });
    const result = { at: new Date().toISOString(), rows: rows, score: clamp(score, 0, 100), stats: { observed: observed, tagged: tagged, taggedRight: taggedRight, askRight: askRight }, finds: finds.map(d => d.id) };
    // 首次分析且全场 ask 全对 → 加分
    const allAsk = village.features.filter(f => f.ask).every(f => v.features[f.id] && v.features[f.id].askOk === 1);
    if (allAsk && village.features.length && !v.analysis) addPoints(state, 6);
    v.analysis = result;
    log(state, 'analyze', vId + '=' + result.score);
    return result;
  }
  function discoverFind(state, vId, findId) {
    const v = vState(state, vId);
    if (!v.finds) v.finds = {};
    if (!v.finds[findId]) { v.finds[findId] = true; addPoints(state, 3); log(state, 'find', findId); return true; }
    return false;
  }

  /* ---------- 学生批注 ---------- */
  const NOTE_CAP = 500;
  function setNote(state, key, text) {
    if (!key) return { ok: false };
    const t = String(text || '').trim().slice(0, NOTE_CAP);
    state.notes = state.notes || {};
    const had = !!state.notes[key];
    if (!t) { delete state.notes[key]; return { ok: true, removed: had }; }
    state.notes[key] = t;
    if (!had) { addPoints(state, 1); log(state, 'note', key); }
    return { ok: true, created: !had };
  }
  function noteOf(state, key) {
    return (state.notes || {})[key] || '';
  }
  function findChapterNote(state, chId) {
    const keys = Object.keys(state.notes || {});
    for (const k of keys) if (k.indexOf(chId + '#') === 0 && state.notes[k]) return state.notes[k];
    return '';
  }

  /* ---------- 报告生成（离线结构化写作） ---------- */
  function buildReport(state, vId, village, book) {
    const v = vState(state, vId);
    const g = village.geoFacts || {};
    const mats = Object.keys(v.talks).flatMap(k => v.talks[k].materials);
    const an = v.analysis;
    const secs = [];
    secs.push({ title: '一、地理背景与村落概况', body: [
      village.intro,
      '地形：' + (g.landform || '—') + '；气候：' + (g.climate || '—') + '。',
      '农业：' + (g.agriculture || '—') + '；生计：' + (g.livelihood || '—') + '；交通：' + (g.transport || '—') + '。'
    ].join('\n') });
    // 二：空间格局
    const featLines = village.features.map(f => {
      const fs = v.features[f.id];
      const tagTxt = fs && fs.myTags && fs.myTags.length ? '（我的标注：' + fs.myTags.map(c => cname(book, c)).join('、') + '）' : '';
      return '· ' + f.name + '：' + f.note + tagTxt;
    });
    secs.push({ title: '二、聚落形态与空间格局', body: '全村共录得 ' + village.features.length + ' 处空间要素：\n' + featLines.join('\n') + (an ? '\n\n空间语义分析得分：' + an.score + '／100。' : '\n\n（空间语义分析尚未运行。）') });
    // 三：社会结构与人文脉络（按概念归组引用素材）
    const byConcept = {};
    mats.forEach(m => (m.tags || []).forEach(t => { (byConcept[t] = byConcept[t] || []).push(m); }));
    const socLines = Object.keys(byConcept).map(c => {
      const list = byConcept[c].slice(0, 2);
      return '【' + cname(book, c) + '】\n' + list.map(m => '「' + m.text + '」（' + m.npcName + '，' + m.role + '）').join('\n');
    });
    secs.push({ title: '三、社会结构与人文脉络', body: socLines.length ? socLines.join('\n\n') + '\n\n（素材共 ' + mats.length + ' 条，本节按概念归组摘引。）' : '（访谈素材尚空——先去与村民对话，再回来生成。）' });
    // 四：经济生产
    const ecoMats = mats.filter(m => /工钱|买卖|卖|谷|桑|烟|银|柿|快递|圩|价/.test(m.text)).slice(0, 4);
    secs.push({ title: '四、经济生产与生计方式', body: [ '主要生计：' + (g.agriculture || '—') + '；' + (g.livelihood || '—') + '。', ecoMats.length ? '村民口述：\n' + ecoMats.map(m => '「' + m.text.slice(0, 120) + '……」（' + m.npcName + '）').join('\n') : '（可在访谈中追问买卖与工钱，充实本节。）' ].join('\n') });
    // 五：以书证乡
    const chs = (village.chapters || []).map(id => book.chapter(id)).filter(Boolean);
    const proofLines = chs.map(ch => {
      const e = ch.excerpts[0] ? '「' + ch.excerpts[0].text.slice(0, 90) + (ch.excerpts[0].text.length > 90 ? '……' : '') + '」（《' + '乡土中国' + '》' + ch.title + '）' : '';
      const hit = rowsHitFor(state, village, ch);
      let line = '· 验证「' + ch.concepts[0].name + '」：' + e + '\n  空间证据：' + (hit || '（待补：回到空间观察页完成标注）');
      const note = findChapterNote(state, ch.id);
      if (note) line += '\n  我的批注：「' + note.slice(0, 120) + (note.length > 120 ? '……' : '') + '」';
      return line;
    });
    secs.push({ title: '五、探究结论——以书证乡', body: proofLines.join('\n') });
    return { village: village.id, sections: secs, plain: secs.map(s => s.title + '\n' + s.body).join('\n\n') };
  }
  function rowsHitFor(state, village, ch) {
    const v = state.villages[village.id];
    if (!v) return '';
    const hits = village.features.filter(f => {
      const fs = v.features[f.id];
      return fs && (fs.myTags || []).some(c => ch.concepts.some(x => x.id === c));
    }).map(f => f.name);
    return hits.length ? hits.slice(0, 3).join('、') : '';
  }
  function cname(book, conceptId) {
    const hit = book.concept(conceptId);
    return hit ? hit.concept.name : conceptId;
  }

  /* ---------- 报告初评（离线规则评分） ---------- */
  function gradeReport(state, vId, text, village, book) {
    const t = String(text || '');
    const advice = [];
    let score = 0;
    const parts = ['一、', '二、', '三、', '四、', '五、'];
    const partHit = parts.filter(p => t.indexOf(p) >= 0).length;
    score += partHit * 6; // 满分30
    if (partHit < 5) advice.push('结构缺 ' + (5 - partHit) + ' 个部分——对照五部分目录补齐。');
    const len = t.replace(/\s/g, '').length;
    if (len >= 400) score += 20; else advice.push('正文仅约 ' + len + ' 字，建议扩至 400 字以上（现在差 ' + (400 - len) + ' 字）。');
    const mats = vState(state, vId).talks ? Object.keys(state.villages[vId].talks).flatMap(k => state.villages[vId].talks[k].materials) : [];
    const npcNames = village.npcs.map(n => n.name);
    const cited = npcNames.filter(n => t.indexOf(n) >= 0).length;
    score += Math.min(20, cited * 7);
    if (cited < 3) advice.push('引用村民口述不足（检出 ' + cited + ' 位）——多引几位不同身份的村民，观点才有互证。');
    const conceptNames = (village.chapters || []).map(id => book.chapter(id)).filter(Boolean).flatMap(ch => ch.concepts.map(c => c.name));
    const used = conceptNames.filter(n => t.indexOf(n) >= 0).length;
    score += Math.min(15, used * 3);
    if (used < 4) advice.push('核心概念出现 ' + used + ' 个（建议 ≥4）——把概念名写进分析，别只讲故事。');
    const quoteHit = (t.match(/「[^」]{8,}」/g) || []).length;
    score += Math.min(15, quoteHit * 5);
    if (quoteHit < 2) advice.push('直接引语（「」）不足 2 处——田野报告要用村民的原话和书里的原文说话。');
    score = clamp(Math.round(score), 0, 100);
    return { score: score, stars: score >= 85 ? 3 : score >= 70 ? 2 : score >= 50 ? 1 : 0, advice: advice, gradedAt: new Date().toISOString() };
  }
  function submitReport(state, vId, text, village, book) {
    const v = vState(state, vId);
    v.report.text = text;
    const grade = gradeReport(state, vId, text, village, book);
    const first = !v.report.submitted;
    const prevBest = v.report.bestScore || 0;
    v.report.submitted = { text: text, grade: grade, verdict: '', at: new Date().toISOString() };
    if (first) addPoints(state, 10);
    if (grade.score >= 85 && grade.score > prevBest) addPoints(state, 5); // 只奖进步，不奖重交
    v.report.bestScore = Math.max(prevBest, grade.score);
    log(state, 'report', vId + '=' + grade.score);
    return grade;
  }

  /* ---------- 双村对比（区域差异分析） ---------- */
  function compareVillages(vA, vB, state, book) {
    const rows = [
      { dim: '地域类型', a: vA.type + '（' + vA.region + '）', b: vB.type + '（' + vB.region + '）' },
      { dim: '地形与气候', a: (vA.geoFacts.landform || '') + '；' + (vA.geoFacts.climate || ''), b: (vB.geoFacts.landform || '') + '；' + (vB.geoFacts.climate || '') },
      { dim: '生计方式', a: vA.geoFacts.livelihood || '', b: vB.geoFacts.livelihood || '' },
      { dim: '聚落形态', a:聚落(vA), b:聚落(vB) },
      { dim: '权力与秩序（空间证据）', a: 权力(vA), b: 权力(vB) },
      { dim: '交换与算账（空间证据）', a: 交换(vA), b: 交换(vB) },
      { dim: '对应章节', a: (vA.chapters || []).map(id => book.chapter(id) ? book.chapter(id).title : id).join('、'), b: (vB.chapters || []).map(id => book.chapter(id) ? book.chapter(id).title : id).join('、') }
    ];
    if (state) {
      const key = [vA.id, vB.id].sort().join('|');
      if (state.compareDone.indexOf(key) < 0) { state.compareDone.push(key); addPoints(state, 4); log(state, 'compare', key); }
    }
    return rows;
  }
  function 聚落(v) { const f = v.features.find(x => x.kind === 'homes'); return f ? f.name + '：' + (f.analysis || f.note) : '—'; }
  function 权力(v) { const f = v.features.find(x => (x.truth || []).indexOf('c08a') >= 0 || (x.truth || []).indexOf('c11a') >= 0); return f ? f.name + '：' + f.note : '—'; }
  function 交换(v) { const f = v.features.find(x => (x.truth || []).indexOf('c12c') >= 0); return f ? f.name + '：' + f.note : '—'; }

  /* ---------- 概念证据图谱（题目↔概念以 feature.truth 为权威映射，不重复维护标签） ---------- */
  function conceptSources(book, villages) {
    const out = {};
    ((book && book.CHAPTERS) || []).forEach(ch => (ch.concepts || []).forEach(c => {
      out[c.id] = { cid: c.id, name: c.name, def: c.def, chapterId: ch.id, chapterNo: ch.no, chapterTitle: ch.title, features: [], rules: [], reportVillages: [], caseHits: [] };
    }));
    const list = (villages && villages.VILLAGES) || [];
    list.forEach(v => {
      (v.chapters || []).forEach(chId => {
        const ch = (book && book.chapter) ? book.chapter(chId) : null;
        if (!ch) return;
        (ch.concepts || []).forEach(c => { if (out[c.id]) out[c.id].reportVillages.push(v.id); });
      });
      (v.features || []).forEach(f => (f.truth || []).forEach(cid => {
        if (out[cid]) out[cid].features.push({ vId: v.id, fId: f.id, name: f.name, ask: f.ask ? f.ask.q : '' });
      }));
      (v.npcs || []).forEach(n => (n.rules || []).forEach(r => {
        if (r.concept && out[r.concept]) out[r.concept].rules.push({ vId: v.id, npcId: n.id, npcName: n.name, kw: (r.kws || [])[0] || '' });
      }));
      if (v.case) (v.case.testimony || []).forEach(t => (t.concepts || []).forEach(cid => {
        if (out[cid]) out[cid].caseHits.push({ vId: v.id, tId: t.id, ask: t.ask });
      }));
    });
    return out;
  }
  function masteryOf(e) {
    const qr = (e && e.quizRight) || 0, qw = (e && e.quizWrong) || 0;
    const tr = (e && e.tagRight) || 0, tw = (e && e.tagWrong) || 0;
    const h = (e && e.heard) || 0, r = (e && e.report) || 0;
    const pos = 2 * qr + 2 * tr + 2 * Math.min(r, 2) + Math.min(h, 2);
    const neg = 2 * qw + 2 * tw;
    let status = 'untouched';
    if (pos >= 4 && pos - neg >= 2) status = 'mastered';
    else if (pos + neg > 0) status = 'fragile';
    return { status: status, pos: pos, neg: neg, score: Math.max(0, pos - neg) };
  }
  // 全部从当前存档纯推导：重做答对会自动覆盖旧错，刷分无意义
  function conceptEvidence(state, book, villages) {
    const src = conceptSources(book, villages);
    const ev = {};
    Object.keys(src).forEach(cid => { ev[cid] = { cid: cid, quizRight: 0, quizWrong: 0, tagRight: 0, tagWrong: 0, heard: 0, report: 0 }; });
    const list = (villages && villages.VILLAGES) || [];
    list.forEach(v => {
      const vs = (state && state.villages) ? state.villages[v.id] : null;
      if (!vs) return;
      (v.features || []).forEach(f => {
        const fs = vs.features && vs.features[f.id];
        if (!fs) return;
        const truth = f.truth || [];
        if (fs.seen && f.ask) truth.forEach(cid => { if (ev[cid]) ev[cid][fs.askOk === 1 ? 'quizRight' : 'quizWrong']++; });
        (fs.myTags || []).forEach(cid => {
          if (ev[cid]) ev[cid][truth.indexOf(cid) >= 0 ? 'tagRight' : 'tagWrong']++;
        });
      });
      Object.keys(vs.talks || {}).forEach(k => (vs.talks[k].materials || []).forEach(m => (m.tags || []).forEach(cid => { if (ev[cid]) ev[cid].heard++; })));
      if (v.case && vs.case) (v.case.testimony || []).forEach(t => {
        if (vs.case.heard && vs.case.heard[t.id]) (t.concepts || []).forEach(cid => { if (ev[cid]) ev[cid].heard++; });
      });
      const sub = vs.report && vs.report.submitted;
      if (sub && sub.text) (v.chapters || []).forEach(chId => {
        const ch = book.chapter(chId);
        if (!ch) return;
        (ch.concepts || []).forEach(c => { if (ev[c.id] && String(sub.text).indexOf(c.name) >= 0) ev[c.id].report++; });
      });
    });
    Object.keys(ev).forEach(cid => {
      const m = masteryOf(ev[cid]);
      ev[cid].status = m.status; ev[cid].pos = m.pos; ev[cid].neg = m.neg;
    });
    return ev;
  }
  function conceptSummary(state, book, villages) {
    const ev = conceptEvidence(state, book, villages);
    const src = conceptSources(book, villages);
    const chapters = ((book && book.CHAPTERS) || []).map(ch => ({
      id: ch.id, no: ch.no, title: ch.title,
      concepts: (ch.concepts || []).map(c => ({
        cid: c.id, name: c.name, def: c.def,
        status: ev[c.id].status, pos: ev[c.id].pos, neg: ev[c.id].neg,
        evidence: ev[c.id], source: src[c.id]
      }))
    }));
    const counts = { mastered: 0, fragile: 0, untouched: 0 };
    chapters.forEach(ch => ch.concepts.forEach(c => { counts[c.status]++; }));
    return {
      total: chapters.reduce((n, ch) => n + ch.concepts.length, 0),
      mastered: counts.mastered, fragile: counts.fragile, untouched: counts.untouched,
      chapters: chapters, evidence: ev, sources: src
    };
  }

  /* ---------- 驻村探案（多地点取证 → 追问解锁 → 结案初评） ---------- */
  function caseState(state, vId) {
    const v = vState(state, vId);
    if (!v.case) v.case = { heard: {}, report: { text: '', submitted: null, bestScore: 0 } };
    if (!v.case.heard) v.case.heard = {};
    if (!v.case.report) v.case.report = { text: '', submitted: null, bestScore: 0 };
    if (typeof v.case.report.bestScore !== 'number') v.case.report.bestScore = 0;
    return v.case;
  }
  function caseProgress(state, vId, kase) {
    const cs = caseState(state, vId);
    const all = (kase && kase.testimony) || [];
    const heard = all.filter(t => cs.heard[t.id]).length;
    const keys = all.filter(t => t.key);
    const keyHeard = keys.filter(t => cs.heard[t.id]).length;
    return { heard: heard, total: all.length, keyHeard: keyHeard, keyTotal: keys.length, canReport: keys.length > 0 && keyHeard >= keys.length };
  }
  function caseAt(state, vId, kase, locId) {
    const cs = caseState(state, vId);
    return ((kase && kase.testimony) || []).filter(t => t.loc === locId).map(t => ({
      testimony: t,
      heard: !!cs.heard[t.id],
      locked: (t.requires || []).some(id => !cs.heard[id])
    }));
  }
  function caseAsk(state, vId, kase, tId) {
    if (!kase) return { ok: false, reason: '这个村子还没有案件。' };
    const t = (kase.testimony || []).find(x => x.id === tId);
    if (!t) return { ok: false, reason: '这条证言不存在。' };
    const cs = caseState(state, vId);
    const missing = (t.requires || []).filter(id => !cs.heard[id]);
    if (missing.length) {
      const names = missing.map(id => { const m = (kase.testimony || []).find(x => x.id === id); return m ? m.ask : id; });
      return { ok: false, reason: '还问不出这句——先听：' + names.join('；'), locked: missing };
    }
    const already = !!cs.heard[tId];
    if (!already) { cs.heard[tId] = new Date().toISOString(); addPoints(state, 1); log(state, 'case-hear', vId + '/' + tId); }
    return { ok: true, text: t.text, already: already, testimony: t, progress: caseProgress(state, vId, kase) };
  }
  function caseGrade(text, kase, village, book) {
    const t = String(text || '');
    const advice = [];
    let score = 0;
    const parts = ['一、', '二、', '三、', '四、'];
    const partHit = parts.filter(p => t.indexOf(p) >= 0).length;
    score += partHit * 6; // 24
    if (partHit < 4) advice.push('结构缺 ' + (4 - partHit) + ' 节——按「案由／双方说法／矛盾与查证／依礼评理」四节写。');
    const len = t.replace(/\s/g, '').length;
    if (len >= 300) score += 16; else advice.push('正文约 ' + len + ' 字，建议写到 300 字以上（还差 ' + Math.max(0, 300 - len) + ' 字）。');
    const names = ((village && village.npcs) || []).map(n => n.name);
    const cited = names.filter(n => t.indexOf(n) >= 0).length;
    score += Math.min(18, cited * 6);
    if (cited < 3) advice.push('引用村民说法不足（检出 ' + cited + ' 位）——至少引三位当事人的原话。');
    const cn = ((kase && kase.concepts) || []).map(cid => cname(book, cid));
    const used = cn.filter(n => t.indexOf(n) >= 0).length;
    score += Math.min(15, used * 5);
    if (used < 2) advice.push('核心概念只出现 ' + used + ' 个（建议 ≥2）——把「无讼」「评理」这类名字用进分析。');
    const factGroups = [['台账', '作业记录'], ['风向', '东南风', '西风'], ['补种', '帮工'], ['认错', '当众']];
    const factHit = factGroups.filter(g => g.some(k => t.indexOf(k) >= 0)).length;
    score += Math.min(15, factHit * 4);
    if (factHit < 3) advice.push('关键事实（台账／风向／补种／认错）落笔不足——结案要能对上证据。');
    const quotes = (t.match(/「[^」]{6,}」/g) || []).length;
    score += Math.min(12, quotes * 4);
    if (quotes < 2) advice.push('直接引语（「」）不足 2 处——让当事人自己说话。');
    score = clamp(Math.round(score), 0, 100);
    return { score: score, stars: score >= 85 ? 3 : score >= 70 ? 2 : score >= 50 ? 1 : 0, advice: advice, gradedAt: new Date().toISOString() };
  }
  function caseSubmit(state, vId, text, kase, village, book) {
    const prog = caseProgress(state, vId, kase);
    if (!prog.canReport) return { ok: false, reason: '关键证言还没听全（' + prog.keyHeard + '/' + prog.keyTotal + '），先别结案。', grade: null, progress: prog };
    const cs = caseState(state, vId);
    const grade = caseGrade(text, kase, village, book);
    const first = !cs.report.submitted;
    const prevBest = cs.report.bestScore || 0;
    cs.report.text = text;
    cs.report.submitted = { text: text, grade: grade, at: new Date().toISOString() };
    if (first) addPoints(state, 10);
    if (grade.score >= 85 && grade.score > prevBest) addPoints(state, 5);
    cs.report.bestScore = Math.max(prevBest, grade.score);
    log(state, 'case-report', vId + '=' + grade.score);
    return { ok: true, grade: grade, first: first, progress: prog };
  }

  /* ---------- 成就与称号 ---------- */
  const ACHIEVEMENTS = [
    { id: 'a01', name: '开卷有益', desc: '读毕第一章', test: s => Object.keys(s.chapters).length >= 1 },
    { id: 'a02', name: '通读全本', desc: '《乡土中国》14 章全部读毕', test: s => Object.keys(s.chapters).length >= 14 },
    { id: 'a03', name: '初级调查员', desc: '一村观察题全部答对', test: s => Object.keys(s.villages).some(vid => {
      const v = s.villages[vid]; const vil = root.XT_VILLAGES.village(vid);
      return vil && vil.features.filter(f => f.ask).every(f => v.features[f.id] && v.features[f.id].askOk === 1);
    }) },
    { id: 'a04', name: '多方求证', desc: '与 3 位以上村民都谈过话', test: s => Object.keys(s.villages).some(vid => Object.keys(s.villages[vid].talks || {}).length >= 3) },
    { id: 'a05', name: '田野高手', desc: '累计收集素材 15 条', test: s => Object.keys(s.villages).reduce((n, vid) => n + Object.keys(s.villages[vid].talks || {}).reduce((m, k) => m + s.villages[vid].talks[k].materials.length, 0), 0) >= 15 },
    { id: 'a06', name: '概念对得上', desc: '任一村空间语义分析 ≥ 80 分', test: s => Object.keys(s.villages).some(vid => s.villages[vid].analysis && s.villages[vid].analysis.score >= 80) },
    { id: 'a07', name: '四村全览', desc: '四个村落都完成空间观察', test: s => root.XT_VILLAGES.VILLAGES.every(v => {
      const vs = s.villages[v.id]; return vs && Object.keys(vs.features || {}).length >= 3;
    }) },
    { id: 'a08', name: '笔耕不辍', desc: '提交第一份考察报告', test: s => Object.keys(s.villages).some(vid => s.villages[vid].report && s.villages[vid].report.submitted) },
    { id: 'a09', name: '著述等身', desc: '四村报告全部提交', test: s => root.XT_VILLAGES.VILLAGES.every(v => s.villages[v.id] && s.villages[v.id].report && s.villages[v.id].report.submitted) },
    { id: 'a10', name: '区域比兴', desc: '完成一次双村对比', test: s => s.compareDone.length >= 1 },
    { id: 'a11', name: '空间慧眼', desc: '集齐 8 处地理"发现"', test: s => Object.keys(s.villages).reduce((n, vid) => n + Object.keys(s.villages[vid].finds || {}).length, 0) >= 8 },
    { id: 'a12', name: '名师点睛', desc: '任一报告初评达优秀（≥85）', test: s => Object.keys(s.villages).some(vid => s.villages[vid].report && s.villages[vid].report.submitted && s.villages[vid].report.submitted.grade.score >= 85) },
    { id: 'a13', name: '熟人社会', desc: '与同一位村民深谈 8 轮以上', test: s => Object.keys(s.villages).some(vid => Object.keys(s.villages[vid].talks || {}).some(k => s.villages[vid].talks[k].turns >= 8)) },
    { id: 'a14', name: '概念成图', desc: '全书掌握 12 个以上核心概念', test: s => conceptSummary(s, root.XT_BOOK, root.XT_VILLAGES).mastered >= 12 },
    { id: 'a15', name: '结案陈词', desc: '探案结案报告初评 ≥80 分', test: s => Object.keys(s.villages).some(vid => {
      const vs = s.villages[vid];
      return vs && vs.case && vs.case.report && vs.case.report.submitted && vs.case.report.submitted.grade.score >= 80;
    }) }
  ];
  function checkAchievements(state) {
    const got = [];
    for (const a of ACHIEVEMENTS) {
      if (state.achievements.indexOf(a.id) >= 0) continue;
      let ok = false;
      try { ok = !!a.test(state); } catch (e) { ok = false; }
      if (ok) { state.achievements.push(a.id); got.push(a); addPoints(state, 8); log(state, 'ach', a.id); }
    }
    return got;
  }
  const LEVELS = [
    { min: 0, name: '乡土学徒' },
    { min: 30, name: '初级调查员' },
    { min: 80, name: '田野行家' },
    { min: 160, name: '人文地理学者' },
    { min: 300, name: '乡土观察家' }
  ];
  function levelOf(points) {
    let cur = LEVELS[0];
    for (const l of LEVELS) if (points >= l.min) cur = l;
    return cur;
  }

  /* ---------- 教师端：模拟班级（种子确定性，明示演示数据） ---------- */
  const DEMO_SURNAMES = ['王', '李', '张', '刘', '陈', '杨', '黄', '赵', '吴', '周', '徐', '孙', '林', '郑', '谢', '沈'];
  const DEMO_GIVENS = ['梓涵', '一诺', '雨桐', '浩然', '欣怡', '子墨', '思远', '若曦', '俊杰', '语汐', '博文', '诗涵', '志强', '梦洁', '嘉懿', '佳琪'];
  const DEMO_MISCONCEPTIONS = [
    '把"愚"理解成智力问题，忽视"机会与需要"的分析',
    '把差序格局画成"团体格局"：圈子画成有固定边界',
    '把"礼治"与"法治"混为一谈，未抓住维持规范的力量差异',
    '只谈横暴权力，忽略"同意权力"与"无为"的限定条件',
    '把"血缘地缘"讲成城乡差别，未落到交换规则上',
    '把"注释式变迁"当成"革命式变迁"，名实分离理解表面化'
  ];
  function demoClass(seed) {
    const rnd = mulberry32(hash32('demo-class|' + (seed || '2026')));
    const students = [];
    const N = 16;
    for (let i = 0; i < N; i++) {
      const name = DEMO_SURNAMES[Math.floor(rnd() * 16)] + DEMO_GIVENS[Math.floor(rnd() * 16)];
      const chapters = Math.floor(rnd() * 15);
      const talkTurns = Math.floor(rnd() * 22);
      const observeScore = Math.floor(rnd() * 101);
      const reportScore = chapters >= 6 ? Math.floor(45 + rnd() * 55) : (rnd() < 0.4 ? Math.floor(rnd() * 60) : -1);
      const misconception = DEMO_MISCONCEPTIONS[Math.floor(rnd() * DEMO_MISCONCEPTIONS.length)];
      students.push({ name: name, chapters: chapters, talkTurns: talkTurns, observeScore: observeScore, reportScore: reportScore, misconception: misconception });
    }
    const agg = {
      avgChapters: Math.round(students.reduce((a, b) => a + b.chapters, 0) / N * 10) / 10,
      avgTalks: Math.round(students.reduce((a, b) => a + b.talkTurns, 0) / N * 10) / 10,
      avgObserve: Math.round(students.reduce((a, b) => a + b.observeScore, 0) / N),
      avgReport: Math.round(students.filter(s => s.reportScore >= 0).reduce((a, b) => a + b.reportScore, 0) / Math.max(1, students.filter(s => s.reportScore >= 0).length)),
      submitted: students.filter(s => s.reportScore >= 0).length,
      misconceptionTop: DEMO_MISCONCEPTIONS.map(m => ({ m: m, n: students.filter(s => s.misconception === m).length })).sort((x, y) => y.n - x.n)[0]
    };
    return { seed: seed || '2026', students: students, agg: agg, demo: true };
  }

  /* ---------- 持久化 ---------- */
  function serialize(state) { return JSON.stringify(state); }
  function deserialize(text) {
    let s;
    try { s = JSON.parse(String(text || '')); } catch (e) { return null; }
    if (!s || typeof s !== 'object' || !s.student) return null;
    const fresh = newState(s.student.name);
    // 浅迁移：保留已知字段，未知忽略
    const merged = Object.assign(fresh, s);
    merged.version = STATE_VERSION;
    merged.settings = s.settings && s.settings.api ? s.settings : fresh.settings;
    merged.villages = s.villages || {};
    merged.chapters = s.chapters || {};
    merged.achievements = Array.isArray(s.achievements) ? s.achievements : [];
    merged.compareDone = Array.isArray(s.compareDone) ? s.compareDone : [];
    merged.tasks = Array.isArray(s.tasks) ? s.tasks : [];
    merged.notes = (s.notes && typeof s.notes === 'object' && !Array.isArray(s.notes)) ? s.notes : {};
    merged.logs = Array.isArray(s.logs) ? s.logs.slice(-200) : [];
    return merged;
  }

  const API = {
    hash32: hash32, mulberry32: mulberry32, normQ: normQ,
    STATE_VERSION: STATE_VERSION,
    newState: newState, vState: vState, log: log, addPoints: addPoints,
    readChapter: readChapter, visit: visit,
    askNpc: askNpc, pickRule: pickRule,
    collectMaterial: collectMaterial, reTagMaterial: reTagMaterial,
    setNote: setNote, noteOf: noteOf, findChapterNote: findChapterNote, NOTE_CAP: NOTE_CAP,
    featureState: featureState, observe: observe, tagFeature: tagFeature,
    analyzeVillage: analyzeVillage, discoverFind: discoverFind,
    buildReport: buildReport, gradeReport: gradeReport, submitReport: submitReport,
    compareVillages: compareVillages,
    conceptSources: conceptSources, conceptEvidence: conceptEvidence, masteryOf: masteryOf, conceptSummary: conceptSummary,
    caseState: caseState, caseProgress: caseProgress, caseAt: caseAt, caseAsk: caseAsk, caseGrade: caseGrade, caseSubmit: caseSubmit,
    ACHIEVEMENTS: ACHIEVEMENTS, checkAchievements: checkAchievements,
    LEVELS: LEVELS, levelOf: levelOf,
    demoClass: demoClass,
    serialize: serialize, deserialize: deserialize,
    conceptName: cname
  };

  root.XT_ENGINE = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
