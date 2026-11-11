/* 村落聚合层：4 个虚拟村落 + 查询助手
 * 依赖：data-village-v1.js ... v4.js 先于本文件加载（浏览器）/ require（Node 测试）
 */
(function (global) {
  'use strict';
  const root = (typeof window !== 'undefined') ? window : global;

  const LIST = [root.XT_VILLAGE_V1, root.XT_VILLAGE_V2, root.XT_VILLAGE_V3, root.XT_VILLAGE_V4];

  const API = {
    VILLAGES: LIST,
    village(id) { return LIST.find(v => v.id === id) || null; },
    feature(vId, fId) {
      const v = API.village(vId);
      return v ? v.features.find(f => f.id === fId) || null : null;
    },
    npc(vId, nId) {
      const v = API.village(vId);
      return v ? v.npcs.find(n => n.id === nId) || null : null;
    },
    find(vId, fdId) {
      const v = API.village(vId);
      return v ? v.finds.find(d => d.id === fdId) || null : null;
    },
    /** 本村概念池：对口章节概念 + 空间真值/发现/NPC 规则实际用到的概念（保证真值永不被池过滤） */
    conceptPool(vId) {
      const v = API.village(vId);
      if (!v) return [];
      const set = new Set();
      (v.chapters || []).forEach(cId => {
        const ch = root.XT_BOOK && root.XT_BOOK.chapter(cId);
        if (ch) ch.concepts.forEach(c => set.add(c.id));
      });
      v.features.forEach(f => (f.truth || []).forEach(c => set.add(c)));
      (v.finds || []).forEach(d => set.add(d.concept));
      v.npcs.forEach(n => n.rules.forEach(r => { if (r.concept) set.add(r.concept); }));
      return Array.from(set);
    }
  };

  root.XT_VILLAGES = API;
  if (typeof module !== 'undefined' && module.exports) module.exports = API;
})(typeof globalThis !== 'undefined' ? globalThis : this);
