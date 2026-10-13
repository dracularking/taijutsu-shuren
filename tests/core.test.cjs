/* 核心逻辑单元测试：node tests/core.test.cjs */
'use strict';

const assert = require('node:assert/strict');
const Core = require('../js/core.js');

let passed = 0;
const failures = [];

function test(name, fn) {
  try {
    fn();
    passed++;
    console.log('  ✓ ' + name);
  } catch (err) {
    failures.push({ name, err });
    console.log('  ✗ ' + name + '\n      ' + err.message);
  }
}

console.log('\ncore.js 单元测试\n');

/* ---------- 基础工具 ---------- */
test('addDays / diffDays 跨月计算', () => {
  assert.equal(Core.addDays('2025-03-01', -1), '2025-02-28');
  assert.equal(Core.addDays('2024-02-28', 1), '2024-02-29');   // 闰年
  assert.equal(Core.addDays('2025-12-31', 1), '2026-01-01');
  assert.equal(Core.diffDays('2025-01-01', '2025-01-31'), 30);
});

test('月历按周一对齐（2025-06-01 是周日）', () => {
  const weeks = Core.monthMatrix(2025, 6);
  assert.equal(weeks[0][0].iso, '2025-05-26');
  assert.equal(weeks[0][6].iso, '2025-06-01');
  assert.equal(weeks[0][6].inMonth, true);
  assert.equal(weeks[0][0].inMonth, false);
  const all = weeks.flat();
  assert.ok(all.some((c) => c.iso === '2025-06-30'), '应包含 6 月 30 日');
});

/* ---------- 规格化 ---------- */
test('normalizeRecord 会裁剪越界值与未知枚举', () => {
  const r = Core.normalizeRecord({
    date: '2025-06-01', items: ['基本功', '基本功', '  ', '型'], minutes: 9999,
    intensity: 9, condition: '瞎写的', tags: 'a,b', content: 123
  });
  assert.equal(r.minutes, 1440);
  assert.equal(r.intensity, 5);
  assert.equal(r.condition, '');
  assert.deepEqual(r.items, ['基本功', '型']);          // 去重去空
  assert.deepEqual(r.tags, ['a', 'b']);
  assert.equal(r.content, '123');
  assert.ok(r.id && r.createdAt && r.updatedAt);
});

test('normalizeRecord 日期非法时回落到今天', () => {
  const r = Core.normalizeRecord({ date: '2025-13-45' });
  assert.equal(r.date, Core.todayISO());
});

test('normalizeState 同 id 保留较新的一条并补默认项目', () => {
  const s = Core.normalizeState({
    records: [
      { id: 'x', date: '2025-06-01', updatedAt: '2025-06-01T00:00:00.000Z', minutes: 10 },
      { id: 'x', date: '2025-06-02', updatedAt: '2025-06-03T00:00:00.000Z', minutes: 30 }
    ]
  });
  assert.equal(s.records.length, 1);
  assert.equal(s.records[0].minutes, 30);
  assert.ok(s.settings.items.length > 0);
  assert.equal(s.version, Core.SCHEMA_VERSION);
});

/* ---------- 筛选 ---------- */
test('filterRecords 支持关键词、项目与时间范围', () => {
  const records = [
    Core.normalizeRecord({ date: '2025-06-01', items: ['基本功'], insight: '重心前倾', minutes: 30 }),
    Core.normalizeRecord({ date: '2025-06-10', items: ['组手'], effect: '撑满五回合', minutes: 60 }),
    Core.normalizeRecord({ date: '2025-07-01', items: ['基本功'], minutes: 20 })
  ];
  assert.equal(Core.filterRecords(records, { query: '重心' }).length, 1);
  assert.equal(Core.filterRecords(records, { item: '基本功' }).length, 2);
  assert.equal(Core.filterRecords(records, { from: '2025-06-05', to: '2025-06-30' }).length, 1);
  assert.equal(Core.filterRecords(records, { query: '基础' }).length, 0);
  assert.equal(Core.filterRecords(records, { query: 'sou' }).length, 0);
});

test('groupByMonth 按月倒序分组', () => {
  const records = [
    Core.normalizeRecord({ date: '2025-05-02', minutes: 10 }),
    Core.normalizeRecord({ date: '2025-06-02', minutes: 20 }),
    Core.normalizeRecord({ date: '2025-06-20', minutes: 30 })
  ];
  const groups = Core.groupByMonth(records, 'desc');
  assert.deepEqual(groups.map((g) => g.key), ['2025-06', '2025-05']);
  assert.equal(groups[0].records.length, 2);
  assert.equal(groups[0].records[0].date, '2025-06-20');
  assert.equal(groups[0].label, '2025年6月');
});

/* ---------- 连续天数 ---------- */
test('computeStreaks 今天已训练时从今天回溯', () => {
  const days = new Set(['2025-06-10', '2025-06-09', '2025-06-08', '2025-06-01']);
  const s = Core.computeStreaks(days, '2025-06-10');
  assert.equal(s.current, 3);
  assert.equal(s.longest, 3);
  assert.equal(s.totalDays, 4);
});

test('computeStreaks 今天未训练时从昨天回溯', () => {
  const days = new Set(['2025-06-10', '2025-06-09']);
  const s = Core.computeStreaks(days, '2025-06-11');
  assert.equal(s.current, 2);
});

test('computeStreaks 断档后归零', () => {
  const days = new Set(['2025-06-01', '2025-06-02', '2025-06-03']);
  const s = Core.computeStreaks(days, '2025-06-20');
  assert.equal(s.current, 0);
  assert.equal(s.longest, 3);
});

/* ---------- 统计 ---------- */
test('computeStats 汇总次数、时长、项目分布与近 30 天', () => {
  const records = [
    Core.normalizeRecord({ date: '2025-06-10', items: ['基本功', '型'], minutes: 60, intensity: 4 }),
    Core.normalizeRecord({ date: '2025-06-09', items: ['基本功'], minutes: 30, intensity: 2 })
  ];
  const s = Core.computeStats(records, '2025-06-10');
  assert.equal(s.count, 2);
  assert.equal(s.totalMinutes, 90);
  assert.equal(s.avgMinutes, 45);
  assert.equal(s.avgIntensity, 3);
  assert.equal(s.trainingDays, 2);
  assert.equal(s.streak, 2);
  assert.equal(s.month.count, 2);
  assert.equal(s.month.minutes, 90);
  assert.equal(s.byItem[0].name, '基本功');
  assert.equal(s.byItem[0].count, 2);
  assert.equal(s.byItem[0].minutes, 60);                       // 60/2 + 30/1
  const 型 = s.byItem.find((x) => x.name === '型');
  assert.equal(型.minutes, 30);
  assert.equal(s.last30.length, 30);
  assert.equal(s.last30[s.last30.length - 1].date, '2025-06-10');
  assert.equal(s.last30Minutes, 90);
});

test('computeStats 空数据不报错', () => {
  const s = Core.computeStats([], '2025-06-10');
  assert.equal(s.count, 0);
  assert.equal(s.avgMinutes, 0);
  assert.equal(s.avgIntensity, 0);
  assert.equal(s.byItem.length, 0);
  assert.equal(s.streak, 0);
});

test('heatmap 返回 12 周且最后一周包含今天', () => {
  const weeks = Core.heatmap([], '2025-06-11', 12);   // 周三
  assert.equal(weeks.length, 12);
  weeks.forEach((w) => assert.equal(w.length, 7));
  const last = weeks[11];
  assert.equal(last[0].date, '2025-06-09');           // 该周周一
  assert.equal(last[2].date, '2025-06-11');
  assert.equal(last[2].isToday, true);
  assert.equal(last[3].future, true);
});

test('heatLevel 分档', () => {
  assert.equal(Core.heatLevel(0), 0);
  assert.equal(Core.heatLevel(29), 1);
  assert.equal(Core.heatLevel(30), 2);
  assert.equal(Core.heatLevel(75), 3);
  assert.equal(Core.heatLevel(200), 4);
});

/* ---------- 导出与导入 ---------- */
test('toCSV 正确转义引号、逗号与换行', () => {
  const records = [Core.normalizeRecord({
    date: '2025-06-01', items: ['基本功'], minutes: 30,
    insight: '他说："今天,不错"\n继续努力'
  })];
  const csv = Core.toCSV(records);
  assert.ok(csv.startsWith('\uFEFF日期,星期,项目'));
  const lines = csv.trim().split('\r\n');
  assert.equal(lines.length, 2);
  assert.ok(lines[1].includes('"他说：""今天,不错""\n继续努力"'));
});

test('toMarkdown 含标题、月份分组与字段', () => {
  const records = [Core.normalizeRecord({ date: '2025-06-01', items: ['型'], minutes: 45, insight: '转身要稳' })];
  const md = Core.toMarkdown(records, Core.normalizeState({ records }));
  assert.ok(md.includes('# 体術修煉 · 訓練記録'));
  assert.ok(md.includes('## 2025年6月'));
  assert.ok(md.includes('2025-06-01（周日）'));
  assert.ok(md.includes('心得：转身要稳'));
});

test('parseImport 支持数组与对象，并在非法输入时报错', () => {
  const a = Core.parseImport('[{"date":"2025-06-01","minutes":10}]');
  assert.equal(a.records.length, 1);
  assert.equal(a.records[0].minutes, 10);
  const b = Core.parseImport(JSON.stringify(Core.sampleState('2025-06-10')));
  assert.ok(b.records.length >= 5);
  assert.throws(() => Core.parseImport('not json'), /JSON 解析失败/);
  assert.throws(() => Core.parseImport('{"foo":1}'), /records/);
});

test('sampleState 生成的数据可被统计', () => {
  const s = Core.normalizeState(Core.sampleState('2025-06-10'));
  const stats = Core.computeStats(s.records, '2025-06-10');
  assert.ok(stats.count >= 5);
  assert.ok(stats.totalMinutes > 0);
  assert.ok(stats.byItem.length > 0);
});

/* ---------- 项目 / 子项目 ---------- */
test('normalizeItems 把老式字符串数组升级成项目树并补默认子项目', () => {
  const tree = Core.normalizeItems(['力量训练', '我的自定义项目']);
  assert.equal(tree.length, 2);
  assert.equal(tree[0].name, '力量训练');
  assert.ok(tree[0].children.indexOf('俯卧撑') >= 0, '力量训练应带默认子项目「俯卧撑」');
  assert.deepEqual(tree[1].children, [], '自定义项目没有默认子项目');
});

test('normalizeItems 保留显式 children（包括空数组）并去重', () => {
  const tree = Core.normalizeItems([
    { name: '力量训练', children: ['俯卧撑', '俯卧撑', '双杠臂屈伸'] },
    { name: '空项目', children: [] },
    '力量训练'
  ]);
  assert.deepEqual(tree.map((n) => n.name), ['力量训练', '空项目']);
  assert.deepEqual(tree[0].children, ['俯卧撑', '双杠臂屈伸']);
  assert.deepEqual(tree[1].children, []);
});

test('itemChildren / itemNames 取值正确', () => {
  const tree = Core.normalizeItems(Core.DEFAULT_ITEM_TREE);
  assert.ok(Core.itemNames(tree).indexOf('有氧・跑步') >= 0);
  assert.ok(Core.itemChildren(tree, '有氧・跑步').indexOf('慢跑') >= 0);
  assert.deepEqual(Core.itemChildren(tree, '不存在的项目'), []);
});

test('normalizeSubItems 支持对象、字符串路径与去重', () => {
  const subs = Core.normalizeSubItems([
    { parent: '力量训练', name: '俯卧撑' },
    '力量训练 > 深蹲',
    '力量训练›俯卧撑'
  ]);
  assert.deepEqual(subs, [
    { parent: '力量训练', name: '俯卧撑' },
    { parent: '力量训练', name: '深蹲' }
  ]);
});

test('记录保存子项目，老记录没有 subItems 也兼容', () => {
  const withSubs = Core.normalizeRecord({ items: ['力量训练'], subItems: [{ parent: '力量训练', name: '俯卧撑' }] });
  assert.deepEqual(withSubs.subItems, [{ parent: '力量训练', name: '俯卧撑' }]);
  const legacy = Core.normalizeRecord({ items: ['力量训练'] });
  assert.deepEqual(legacy.subItems, []);
});

test('子项目可搜索、可按子项目筛选', () => {
  const records = [
    Core.normalizeRecord({ date: '2026-10-01', items: ['力量训练'], subItems: [{ parent: '力量训练', name: '俯卧撑' }] }),
    Core.normalizeRecord({ date: '2026-10-02', items: ['有氧・跑步'], subItems: [{ parent: '有氧・跑步', name: '慢跑' }] })
  ];
  assert.equal(Core.filterRecords(records, { query: '俯卧撑' }).length, 1);
  assert.equal(Core.filterRecords(records, { subItem: '慢跑' }).length, 1);
  assert.equal(Core.filterRecords(records, { item: '力量训练', subItem: '慢跑' }).length, 0);
});

test('computeStats 统计子项目维度', () => {
  const records = [
    Core.normalizeRecord({ date: '2026-10-01', items: ['力量训练'], minutes: 60,
      subItems: [{ parent: '力量训练', name: '俯卧撑' }, { parent: '力量训练', name: '深蹲' }] }),
    Core.normalizeRecord({ date: '2026-10-02', items: ['力量训练'], minutes: 40,
      subItems: [{ parent: '力量训练', name: '俯卧撑' }] })
  ];
  const s = Core.computeStats(records, '2026-10-02');
  assert.equal(s.activeSubItems, 2);
  const pushUp = s.bySubItem.find((x) => x.name === '俯卧撑');
  assert.equal(pushUp.parent, '力量训练');
  assert.equal(pushUp.count, 2);
  assert.equal(pushUp.minutes, 30 + 40);            // 60 分钟按两个子项目分摊 30，再加 40
  assert.equal(s.subItemsOf('力量训练').length, 2);
  assert.equal(s.subItemsOf('有氧・跑步').length, 0);
});

test('导出：CSV 有子项目列，Markdown 带子项目与项目清单', () => {
  const record = Core.normalizeRecord({ date: '2026-10-01', items: ['力量训练'], minutes: 30,
    subItems: [{ parent: '力量训练', name: '俯卧撑' }] });
  const csv = Core.toCSV([record]);
  assert.ok(csv.indexOf('日期,星期,项目,子项目,时长(分)') > 0);
  assert.ok(csv.indexOf('力量训练›俯卧撑') > 0);
  const md = Core.toMarkdown([record], Core.normalizeState({ records: [record] }));
  assert.ok(md.indexOf('力量训练（力量训练›俯卧撑）') > 0);
  assert.ok(md.indexOf('- 力量训练（子项目：俯卧撑、深蹲') > 0);
});

test('示例数据自带子项目且统计可用', () => {
  const state = Core.normalizeState(Core.sampleState('2026-10-07'));
  const stats = Core.computeStats(state.records, '2026-10-07');
  assert.ok(stats.activeSubItems >= 5, 'activeSubItems=' + stats.activeSubItems);
  assert.ok(state.records.every((r) => Array.isArray(r.subItems)));
  assert.ok(state.records.some((r) => r.subItems.length > 0));
});

/* ---------- 个数 ---------- */
test('normalizeRecord 保留项目与子项目的个数，丢掉 0 和无关项目', () => {
  const r = Core.normalizeRecord({
    items: ['力量训练', '有氧・跑步'],
    itemCounts: { '有氧・跑步': 6, '力量训练': 0, '不存在的项目': 99 },
    subItems: [
      { parent: '力量训练', name: '引体向上', count: 8 },
      { parent: '力量训练', name: '俯卧撑' }
    ]
  });
  assert.deepEqual(r.itemCounts, { '有氧・跑步': 6 });
  assert.deepEqual(r.subItems, [
    { parent: '力量训练', name: '引体向上', count: 8 },
    { parent: '力量训练', name: '俯卧撑' }
  ]);
  assert.equal(Core.totalCount(r), 14);
});

test('normalizeSubItems 个数会裁剪到合理范围', () => {
  const subs = Core.normalizeSubItems([
    { parent: '力量训练', name: '引体向上', count: 999999 },
    { parent: '力量训练', name: '俯卧撑', count: -5 }
  ]);
  assert.equal(subs[0].count, 100000);
  assert.equal(subs[1].count, undefined);            // 0 / 负数被省略
});

test('computeStats 汇总项目与子项目的个数', () => {
  const records = [
    Core.normalizeRecord({ date: '2026-10-01', items: ['力量训练'], minutes: 60,
      subItems: [{ parent: '力量训练', name: '引体向上', count: 8 }, { parent: '力量训练', name: '俯卧撑', count: 30 }] }),
    Core.normalizeRecord({ date: '2026-10-02', items: ['力量训练'], minutes: 40, itemCounts: { '力量训练': 20 } })
  ];
  const s = Core.computeStats(records, '2026-10-02');
  assert.equal(s.bySubItem.find((x) => x.name === '引体向上').reps, 8);
  assert.equal(s.bySubItem.find((x) => x.name === '俯卧撑').reps, 30);
  assert.equal(s.byItem.find((x) => x.name === '力量训练').reps, 20);
  assert.equal(s.totalReps, 58);
});

test('导出含个数：CSV 有「个数」列，Markdown 带 ×个数 与合计', () => {
  const record = Core.normalizeRecord({ date: '2026-10-01', items: ['力量训练'], minutes: 30,
    subItems: [{ parent: '力量训练', name: '引体向上', count: 8 }] });
  const csv = Core.toCSV([record]);
  assert.ok(csv.indexOf('子项目,时长(分),个数,强度') > 0);
  assert.ok(csv.indexOf('力量训练›引体向上×8') > 0);
  assert.ok(csv.indexOf(',30,8,') > 0);
  const md = Core.toMarkdown([record], Core.normalizeState({ records: [record] }));
  assert.ok(md.indexOf('力量训练›引体向上×8') > 0);
  assert.ok(md.indexOf('共 8 个') > 0);
});

test('esc 转义 HTML，避免记录内容破坏页面', () => {
  assert.equal(Core.esc('<img src=x onerror=alert(1)>'), '&lt;img src=x onerror=alert(1)&gt;');
  assert.equal(Core.esc('a"b\'c&d'), 'a&quot;b&#39;c&amp;d');
});

console.log('\n' + (failures.length ? '✗' : '✓') + ' ' + passed + ' 项通过，' + failures.length + ' 项失败\n');
process.exitCode = failures.length ? 1 : 0;
