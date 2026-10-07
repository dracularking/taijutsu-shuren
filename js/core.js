/* ============================================================
   体術修煉 · core.js
   纯逻辑层：数据规格化、筛选、统计、导出格式化。
   不依赖 DOM，可在浏览器与 Node 中同时使用（便于单元测试）。
   ============================================================ */
(function (root, factory) {
  const api = factory();
  root.TRCore = api;
  if (typeof module === 'object' && module.exports) module.exports = api;
})(typeof globalThis !== 'undefined' ? globalThis : this, function () {
  'use strict';

  const SCHEMA_VERSION = 1;

  /* 训练项目 = 项目 + 子项目（例如「力量训练」下面有「俯卧撑」） */
  const DEFAULT_ITEM_TREE = [
    { name: '基本功', children: ['马步冲拳', '基本步法', '踢腿', '桩功'] },
    { name: '型・套路', children: ['单式练习', '整套演练', '拆招'] },
    { name: '组手・对练', children: ['条件对练', '自由对练', '防守反击'] },
    { name: '柔韧・开胯', children: ['动态拉伸', '静态拉伸', '劈叉'] },
    { name: '核心力量', children: ['平板支撑', '卷腹', '俄罗斯转体'] },
    { name: '力量训练', children: ['俯卧撑', '深蹲', '引体向上', '壶铃摇摆', '硬拉'] },
    { name: '有氧・跑步', children: ['慢跑', '间歇跑', '跳绳', '骑行'] },
    { name: '步法・身法', children: ['滑步', '交叉步', '转身'] },
    { name: '兵器训练', children: ['基本挥击', '套路', '对练'] },
    { name: '打靶・沙袋', children: ['拳法打靶', '腿法打靶', '沙袋组合'] },
    { name: '体能・间歇', children: ['波比跳', '冲刺跑', '循环组'] },
    { name: '拉伸放松', children: ['腿部拉伸', '肩背拉伸', '泡沫轴'] },
    { name: '冥想・呼吸', children: ['静坐', '腹式呼吸', '站桩'] }
  ];

  const DEFAULT_ITEMS = DEFAULT_ITEM_TREE.map(function (node) { return node.name; });

  function defaultChildren(name) {
    const hit = DEFAULT_ITEM_TREE.find(function (n) { return n.name === name; });
    return hit ? hit.children.slice() : [];
  }

  const CONDITIONS = ['状态极佳', '良好', '普通', '疲劳', '有旧伤 / 疼痛', '生病 / 恢复中'];
  const WEEKDAYS = ['一', '二', '三', '四', '五', '六', '日'];
  const INTENSITY_LABEL = { 1: '轻松', 2: '偏轻', 3: '适中', 4: '吃力', 5: '极限' };

  /* ------------------------- 基础工具 ------------------------- */

  function esc(value) {
    return String(value == null ? '' : value)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  function uid() {
    if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID();
    return 'r-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 10);
  }

  function pad2(n) { return String(n).padStart(2, '0'); }

  function toISO(date) {
    return date.getFullYear() + '-' + pad2(date.getMonth() + 1) + '-' + pad2(date.getDate());
  }

  function parseISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ''));
    if (!m) return null;
    const y = Number(m[1]), mo = Number(m[2]), day = Number(m[3]);
    const d = new Date(y, mo - 1, day);
    if (isNaN(d.getTime())) return null;
    // 拒绝 2025-13-45 这类会自动进位的“假日期”
    if (d.getFullYear() !== y || d.getMonth() !== mo - 1 || d.getDate() !== day) return null;
    return d;
  }

  function isValidISO(iso) { return !!parseISO(iso); }

  function todayISO(now) { return toISO(now ? new Date(now) : new Date()); }

  function addDays(iso, days) {
    const d = parseISO(iso);
    if (!d) return iso;
    d.setDate(d.getDate() + days);
    return toISO(d);
  }

  function diffDays(aISO, bISO) {
    const a = parseISO(aISO), b = parseISO(bISO);
    if (!a || !b) return NaN;
    return Math.round((b - a) / 86400000);
  }

  function weekdayIndexMonday(iso) {
    const d = parseISO(iso);
    return d ? (d.getDay() + 6) % 7 : 0;
  }

  function weekdayCN(iso) {
    const d = parseISO(iso);
    return d ? WEEKDAYS[(d.getDay() + 6) % 7] : '';
  }

  function formatDateCN(iso) {
    const d = parseISO(iso);
    if (!d) return String(iso || '');
    return d.getFullYear() + '年' + (d.getMonth() + 1) + '月' + d.getDate() + '日';
  }

  function monthKey(iso) { return String(iso || '').slice(0, 7); }

  function formatMonthCN(key) {
    const m = /^(\d{4})-(\d{2})$/.exec(String(key || ''));
    return m ? m[1] + '年' + Number(m[2]) + '月' : String(key || '');
  }

  function num(value, fallback) {
    const n = Number(value);
    return Number.isFinite(n) ? n : (fallback || 0);
  }

  function clampInt(value, min, max, fallback) {
    let n = Math.round(num(value, fallback));
    if (!Number.isFinite(n)) n = fallback;
    return Math.min(max, Math.max(min, n));
  }

  function uniqueStrings(list, limit) {
    const out = [];
    const seen = new Set();
    (Array.isArray(list) ? list : []).forEach(function (raw) {
      const s = String(raw == null ? '' : raw).trim();
      if (!s || seen.has(s)) return;
      seen.add(s);
      out.push(limit ? s.slice(0, limit) : s);
    });
    return out;
  }

  function splitTags(text) {
    return uniqueStrings(String(text || '').split(/[,，、;；\s]+/), 24);
  }

  /* 项目树：把 ['力量训练'] 或 [{name:'力量训练',children:['俯卧撑']}] 统一成节点数组 */
  function normalizeItems(raw) {
    const list = Array.isArray(raw) ? raw : [];
    const out = [];
    const seen = new Set();
    list.forEach(function (entry) {
      const isNode = entry && typeof entry === 'object';
      const name = String(isNode ? entry.name : entry == null ? '' : entry).trim().slice(0, 20);
      if (!name || seen.has(name)) return;
      seen.add(name);
      let children;
      if (isNode && Array.isArray(entry.children)) {
        children = uniqueStrings(entry.children, 30).map(function (c) { return c.slice(0, 20); });
      } else if (!isNode || entry.children === undefined) {
        children = defaultChildren(name);   // 老数据（纯字符串）或没写 children：补上默认子项目
      } else {
        children = [];
      }
      out.push({ name: name, children: children.filter(function (c) { return c !== name; }) });
    });
    return out;
  }

  /* 兼容外部读取：扁平的项目名数组 */
  function itemNames(tree) {
    return (Array.isArray(tree) ? tree : []).map(function (node) {
      return String(node && node.name ? node.name : node || '');
    }).filter(Boolean);
  }

  /* 取某个项目下的子项目 */
  function itemChildren(tree, parentName) {
    const hit = (Array.isArray(tree) ? tree : []).find(function (node) {
      return node && node.name === parentName;
    });
    return hit && Array.isArray(hit.children) ? hit.children.slice() : [];
  }

  /* 记录里的子项目：统一成 [{parent, name}] */
  function normalizeSubItems(raw) {
    const out = [];
    const seen = new Set();
    (Array.isArray(raw) ? raw : []).forEach(function (entry) {
      let parent = '', name = '';
      if (entry && typeof entry === 'object') {
        parent = String(entry.parent || '').trim().slice(0, 20);
        name = String(entry.name || entry.child || '').trim().slice(0, 20);
      } else if (typeof entry === 'string') {
        const parts = entry.split(/\s*[>›/]\s*/);
        if (parts.length >= 2) { parent = parts[0].trim().slice(0, 20); name = parts[1].trim().slice(0, 20); }
        else name = entry.trim().slice(0, 20);
      }
      if (!name) return;
      const key = parent + '›' + name;
      if (seen.has(key)) return;
      seen.add(key);
      out.push({ parent: parent, name: name });
    });
    return out.slice(0, 30);
  }

  /* ------------------------- 数据规格化 ------------------------- */

  function normalizeRecord(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const now = new Date().toISOString();
    const date = isValidISO(raw.date) ? raw.date : todayISO();
    return {
      id: typeof raw.id === 'string' && raw.id ? raw.id : uid(),
      date: date,
      items: uniqueStrings(raw.items, 20),
      subItems: normalizeSubItems(raw.subItems),
      minutes: clampInt(raw.minutes, 0, 1440, 0),
      intensity: clampInt(raw.intensity, 0, 5, 0),
      content: String(raw.content || '').slice(0, 4000),
      insight: String(raw.insight || '').slice(0, 4000),
      effect: String(raw.effect || '').slice(0, 4000),
      condition: CONDITIONS.indexOf(raw.condition) >= 0 ? raw.condition : '',
      tags: typeof raw.tags === 'string' ? splitTags(raw.tags) : uniqueStrings(raw.tags, 12),
      createdAt: typeof raw.createdAt === 'string' ? raw.createdAt : now,
      updatedAt: typeof raw.updatedAt === 'string' ? raw.updatedAt : now
    };
  }

  function emptyState() {
    return {
      version: SCHEMA_VERSION,
      settings: { items: normalizeItems(DEFAULT_ITEM_TREE), theme: 'dark' },
      records: []
    };
  }

  function normalizeState(input) {
    const raw = input && typeof input === 'object' ? input : {};
    const base = emptyState();
    const settingsRaw = raw.settings && typeof raw.settings === 'object' ? raw.settings : {};
    const items = normalizeItems(settingsRaw.items);
    const records = (Array.isArray(raw.records) ? raw.records : []).map(normalizeRecord);
    // 去重：同 id 保留 updatedAt 较新的一条
    const byId = new Map();
    records.forEach(function (r) {
      const prev = byId.get(r.id);
      if (!prev || String(r.updatedAt) >= String(prev.updatedAt)) byId.set(r.id, r);
    });
    return {
      version: SCHEMA_VERSION,
      settings: {
        items: items.length ? items : base.settings.items,
        theme: settingsRaw.theme === 'light' ? 'light' : 'dark'
      },
      records: Array.from(byId.values())
    };
  }

  /* ------------------------- 查询与筛选 ------------------------- */

  function sortRecords(records, dir) {
    const sign = dir === 'asc' ? 1 : -1;
    return records.slice().sort(function (a, b) {
      if (a.date !== b.date) return (a.date < b.date ? -1 : 1) * sign;
      const ac = String(a.createdAt || ''), bc = String(b.createdAt || '');
      if (ac !== bc) return (ac < bc ? -1 : 1) * sign;
      return 0;
    });
  }

  function recordHaystack(r) {
    return [
      r.items.join(' '),
      (r.subItems || []).map(function (s) { return s.parent + ' ' + s.name; }).join(' '),
      r.content, r.insight, r.effect, r.condition, r.tags.join(' '), r.date
    ].join(' ').toLowerCase();
  }

  function filterRecords(records, opts) {
    const o = opts || {};
    const q = String(o.query || '').trim().toLowerCase();
    const since = o.from || '';
    const until = o.to || '';
    return records.filter(function (r) {
      if (o.item && r.items.indexOf(o.item) < 0) return false;
      if (o.subItem && !(r.subItems || []).some(function (s) { return s.name === o.subItem; })) return false;
      if (since && r.date < since) return false;
      if (until && r.date > until) return false;
      if (q && recordHaystack(r).indexOf(q) < 0) return false;
      return true;
    });
  }

  function groupByMonth(records, dir) {
    const sorted = sortRecords(records, dir || 'desc');
    const groups = [];
    const index = new Map();
    sorted.forEach(function (r) {
      const key = monthKey(r.date);
      if (!index.has(key)) {
        const g = { key: key, label: formatMonthCN(key), records: [] };
        index.set(key, g);
        groups.push(g);
      }
      index.get(key).records.push(r);
    });
    return groups;
  }

  /* ------------------------- 日历 ------------------------- */

  function monthMatrix(year, month) {
    const first = new Date(year, month - 1, 1);
    const offset = (first.getDay() + 6) % 7;      // 周一为一周之始
    const start = new Date(year, month - 1, 1 - offset);
    const weeks = [];
    let cursor = start;
    for (let w = 0; w < 6; w++) {
      const week = [];
      for (let d = 0; d < 7; d++) {
        week.push({
          iso: toISO(cursor),
          day: cursor.getDate(),
          inMonth: cursor.getMonth() === month - 1
        });
        cursor = new Date(cursor.getFullYear(), cursor.getMonth(), cursor.getDate() + 1);
      }
      weeks.push(week);
      if (w >= 4 && cursor.getMonth() !== month - 1) break;
    }
    return weeks;
  }

  function minutesByDate(records) {
    const map = new Map();
    records.forEach(function (r) {
      map.set(r.date, (map.get(r.date) || 0) + num(r.minutes));
    });
    return map;
  }

  function heatLevel(minutes) {
    const m = num(minutes);
    if (m <= 0) return 0;
    if (m < 30) return 1;
    if (m < 60) return 2;
    if (m < 90) return 3;
    return 4;
  }

  /* ------------------------- 统计 ------------------------- */

  function computeStreaks(daySet, today) {
    let current = 0;
    let cursor = daySet.has(today) ? today : addDays(today, -1);
    while (daySet.has(cursor)) { current++; cursor = addDays(cursor, -1); }

    const days = Array.from(daySet).sort();
    let longest = 0, run = 0, prev = null;
    days.forEach(function (d) {
      run = (prev && diffDays(prev, d) === 1) ? run + 1 : 1;
      longest = Math.max(longest, run);
      prev = d;
    });
    if (current === 0 && days.length === 1 && days[0] === addDays(today, -1)) current = 1;
    return { current: current, longest: Math.max(longest, current), totalDays: days.length };
  }

  function computeStats(records, today) {
    const t = isValidISO(today) ? today : todayISO();
    const minutesByDay = minutesByDate(records);
    const daySet = new Set(minutesByDay.keys());
    const streaks = computeStreaks(daySet, t);

    const totalMinutes = records.reduce(function (s, r) { return s + num(r.minutes); }, 0);

    const byItemMap = new Map();
    records.forEach(function (r) {
      r.items.forEach(function (name) {
        const cur = byItemMap.get(name) || { name: name, count: 0, minutes: 0 };
        cur.count++;
        cur.minutes += num(r.minutes) / Math.max(1, r.items.length);
        byItemMap.set(name, cur);
      });
    });
    const byItem = Array.from(byItemMap.values()).map(function (x) {
      x.minutes = Math.round(x.minutes);
      return x;
    }).sort(function (a, b) { return b.count - a.count || b.minutes - a.minutes; });

    // 子项目维度：力量训练 › 俯卧撑
    const bySubItemMap = new Map();
    records.forEach(function (r) {
      const subs = r.subItems || [];
      subs.forEach(function (sub) {
        const key = sub.parent + '›' + sub.name;
        const cur2 = bySubItemMap.get(key) || { parent: sub.parent, name: sub.name, count: 0, minutes: 0 };
        cur2.count++;
        cur2.minutes += num(r.minutes) / Math.max(1, subs.length);
        bySubItemMap.set(key, cur2);
      });
    });
    const bySubItem = Array.from(bySubItemMap.values()).map(function (x) {
      x.minutes = Math.round(x.minutes);
      return x;
    }).sort(function (a, b) { return b.count - a.count || b.minutes - a.minutes; });
    const subItemsOf = function (parentName) {
      return bySubItem.filter(function (x) { return x.parent === parentName; });
    };

    const intensityAvgs = records.filter(function (r) { return r.intensity > 0; });
    const avgIntensity = intensityAvgs.length
      ? Math.round(intensityAvgs.reduce(function (s, r) { return s + r.intensity; }, 0) / intensityAvgs.length * 10) / 10
      : 0;

    const thisMonth = monthKey(t);
    const prevMonth = monthKey(addDays(t.slice(0, 7) + '-01', -1));
    const inMonth = function (key) { return records.filter(function (r) { return monthKey(r.date) === key; }); };
    const cur = inMonth(thisMonth), prev = inMonth(prevMonth);
    const sumMin = function (list) { return list.reduce(function (s, r) { return s + num(r.minutes); }, 0); };

    const window30 = [];
    for (let i = 29; i >= 0; i--) {
      const iso = addDays(t, -i);
      window30.push({ date: iso, minutes: minutesByDay.get(iso) || 0, count: 0 });
    }
    records.forEach(function (r) {
      const slot = window30.find(function (x) { return x.date === r.date; });
      if (slot) slot.count++;
    });

    return {
      today: t,
      count: records.length,
      trainingDays: streaks.totalDays,
      totalMinutes: totalMinutes,
      avgMinutes: records.length ? Math.round(totalMinutes / records.length) : 0,
      avgIntensity: avgIntensity,
      streak: streaks.current,
      longestStreak: streaks.longest,
      month: { key: thisMonth, count: cur.length, minutes: sumMin(cur) },
      prevMonth: { key: prevMonth, count: prev.length, minutes: sumMin(prev) },
      last30: window30,
      last30Minutes: window30.reduce(function (s, x) { return s + x.minutes; }, 0),
      byItem: byItem,
      bySubItem: bySubItem,
      subItemsOf: subItemsOf,
      minutesByDay: minutesByDay,
      activeItems: byItemMap.size,
      activeSubItems: bySubItemMap.size
    };
  }

  function heatmap(records, today, weeks) {
    const t = isValidISO(today) ? today : todayISO();
    const n = Math.max(1, weeks || 12);
    const byDay = minutesByDate(records);
    const mondayOfThisWeek = addDays(t, -weekdayIndexMonday(t));
    const out = [];
    for (let w = n - 1; w >= 0; w--) {
      const weekStart = addDays(mondayOfThisWeek, -w * 7);
      const week = [];
      for (let d = 0; d < 7; d++) {
        const iso = addDays(weekStart, d);
        const minutes = byDay.get(iso) || 0;
        week.push({
          date: iso, minutes: minutes, level: heatLevel(minutes),
          future: iso > t, isToday: iso === t
        });
      }
      out.push(week);
    }
    return out;
  }

  /* ------------------------- 导出 ------------------------- */

  function csvCell(value) {
    const s = String(value == null ? '' : value);
    return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
  }

  function subItemsText(r, sep) {
    return (r.subItems || []).map(function (s) {
      return s.parent ? s.parent + '›' + s.name : s.name;
    }).join(sep || '、');
  }

  function toCSV(records) {
    const head = ['日期', '星期', '项目', '子项目', '时长(分)', '强度', '身体状况', '内容', '心得', '效果', '标签'];
    const rows = sortRecords(records, 'asc').map(function (r) {
      return [
        r.date, weekdayCN(r.date), r.items.join(' / '), subItemsText(r, ' / '), r.minutes, r.intensity || '',
        r.condition, r.content, r.insight, r.effect, r.tags.join(' / ')
      ].map(csvCell).join(',');
    });
    return '\uFEFF' + [head.join(',')].concat(rows).join('\r\n') + '\r\n';
  }

  function toMarkdown(records, state) {
    const groups = groupByMonth(records, 'desc');
    const lines = ['# 体術修煉 · 訓練記録', '', '导出时间：' + new Date().toLocaleString('zh-CN'), ''];
    const stats = computeStats(records);
    lines.push('共 **' + stats.count + '** 次训练，累计 **' + stats.totalMinutes + '** 分钟，'
      + '训练天数 **' + stats.trainingDays + '** 天，当前连续 **' + stats.streak + '** 天。', '');
    groups.forEach(function (g) {
      const mins = g.records.reduce(function (s, r) { return s + num(r.minutes); }, 0);
      lines.push('## ' + g.label + '（' + g.records.length + ' 次 · ' + mins + ' 分钟）', '');
      g.records.forEach(function (r) {
        const head = '- **' + r.date + '（周' + weekdayCN(r.date) + '）** '
          + (r.items.length ? r.items.join('、') : '未分类')
          + ((r.subItems || []).length ? '（' + subItemsText(r) + '）' : '')
          + ' · ' + r.minutes + ' 分钟'
          + (r.intensity ? ' · 强度 ' + r.intensity + '/5 ' + (INTENSITY_LABEL[r.intensity] || '') : '')
          + (r.condition ? ' · ' + r.condition : '');
        lines.push(head);
        if (r.content) lines.push('  - 内容：' + r.content.replace(/\n/g, ' / '));
        if (r.insight) lines.push('  - 心得：' + r.insight.replace(/\n/g, ' / '));
        if (r.effect) lines.push('  - 效果：' + r.effect.replace(/\n/g, ' / '));
        if (r.tags.length) lines.push('  - 标签：' + r.tags.join('、'));
      });
      lines.push('');
    });
    const tree = state && state.settings ? normalizeItems(state.settings.items) : [];
    if (tree.length) {
      lines.push('---', '', '项目清单：');
      tree.forEach(function (node) {
        lines.push('- ' + node.name + (node.children.length ? '（子项目：' + node.children.join('、') + '）' : ''));
      });
    }
    return lines.join('\n');
  }

  function toJSON(state) {
    return JSON.stringify(normalizeState(state), null, 2);
  }

  function parseImport(text) {
    let data;
    try { data = JSON.parse(String(text || '')); }
    catch (e) { throw new Error('JSON 解析失败：' + e.message); }
    if (Array.isArray(data)) data = { records: data };
    if (!data || typeof data !== 'object' || !Array.isArray(data.records)) {
      throw new Error('JSON 里没有找到 records 数组。');
    }
    return {
      records: data.records.map(normalizeRecord),
      settings: data.settings && typeof data.settings === 'object' ? data.settings : null
    };
  }

  function sampleState(today) {
    const t = isValidISO(today) ? today : todayISO();
    const mk = function (offset, items, minutes, intensity, content, insight, effect, tags, condition, subItems) {
      return normalizeRecord({
        date: addDays(t, -offset), items: items, subItems: subItems || [],
        minutes: minutes, intensity: intensity,
        content: content, insight: insight, effect: effect, tags: tags || [], condition: condition || ''
      });
    };
    return normalizeState({
      settings: { items: DEFAULT_ITEM_TREE, theme: 'dark' },
      records: [
        mk(0, ['基本功', '型・套路'], 75, 4, '马步冲拳 3 组 × 50，平安初段 5 遍，慢速拆解。',
          '重心还是容易前倾，收拳贴在腰侧时肩要松。', '平安初段后半段不用停顿了，转身角度稳了。', ['自主練'], '良好',
          [{ parent: '基本功', name: '马步冲拳' }, { parent: '型・套路', name: '整套演练' }]),
        mk(1, ['组手・对练', '体能・间歇'], 60, 5, '轻接触组手 5 回合 × 2 分钟，间歇 30 秒跳绳。',
          '第三回合后呼吸乱了，防守手会掉。', '撑满 5 回合，比上周多一回合。', ['道場'], '疲劳',
          [{ parent: '组手・对练', name: '条件对练' }, { parent: '体能・间歇', name: '跳绳' }]),
        mk(3, ['柔韧・开胯', '拉伸放松'], 40, 2, '动态开胯 + 静态拉伸，重点在髋屈肌与腘绳肌。',
          '左髋比右髋紧很多，明天先热敷。', '横叉比上个月低了 3cm。', ['自主練'], '普通',
          [{ parent: '柔韧・开胯', name: '劈叉' }, { parent: '拉伸放松', name: '腿部拉伸' }]),
        mk(5, ['力量训练', '核心力量'], 55, 4, '引体 5×6，平板支撑 3×60 秒，壶铃摆荡 4×15。',
          '核心收不紧时腰会代偿，注意呼吸。', '引体从 4 个到 6 个。', ['自主練'], '良好',
          [{ parent: '力量训练', name: '引体向上' }, { parent: '力量训练', name: '壶铃摇摆' },
            { parent: '核心力量', name: '平板支撑' }]),
        mk(8, ['有氧・跑步'], 45, 3, '慢跑 6 公里，配速约 6:10。',
          '前 2 公里小腿发紧，跑开后舒服了。', '连续跑完 6 公里不停。', ['早课'], '良好',
          [{ parent: '有氧・跑步', name: '慢跑' }]),
        mk(12, ['基本功', '步法・身法'], 50, 3, '滑步、交叉步、转身，配合影子对练。',
          '滑步时脚掌贴地太少，噪音大。', '转身后衔接出拳快了半拍。', [], '普通',
          [{ parent: '基本功', name: '基本步法' }, { parent: '步法・身法', name: '滑步' }])
      ]
    });
  }

  return {
    SCHEMA_VERSION: SCHEMA_VERSION,
    DEFAULT_ITEMS: DEFAULT_ITEMS,
    DEFAULT_ITEM_TREE: DEFAULT_ITEM_TREE,
    CONDITIONS: CONDITIONS,
    WEEKDAYS: WEEKDAYS,
    INTENSITY_LABEL: INTENSITY_LABEL,
    esc: esc, uid: uid, pad2: pad2,
    toISO: toISO, parseISO: parseISO, isValidISO: isValidISO,
    todayISO: todayISO, addDays: addDays, diffDays: diffDays,
    weekdayCN: weekdayCN, weekdayIndexMonday: weekdayIndexMonday,
    formatDateCN: formatDateCN, monthKey: monthKey, formatMonthCN: formatMonthCN,
    num: num, clampInt: clampInt, uniqueStrings: uniqueStrings, splitTags: splitTags,
    normalizeItems: normalizeItems, itemNames: itemNames, itemChildren: itemChildren,
    normalizeSubItems: normalizeSubItems, subItemsText: subItemsText, defaultChildren: defaultChildren,
    normalizeRecord: normalizeRecord, normalizeState: normalizeState, emptyState: emptyState,
    sortRecords: sortRecords, filterRecords: filterRecords, groupByMonth: groupByMonth,
    monthMatrix: monthMatrix, minutesByDate: minutesByDate, heatLevel: heatLevel,
    computeStreaks: computeStreaks, computeStats: computeStats, heatmap: heatmap,
    toCSV: toCSV, toMarkdown: toMarkdown, toJSON: toJSON, parseImport: parseImport,
    sampleState: sampleState
  };
});
