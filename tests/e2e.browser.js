/* ============================================================
   浏览器端端到端检查（由 tests/e2e.cjs 注入到 index.html 副本中运行）
   结果以 E2E-BEGIN ... E2E-END 的形式写进页面，供 runner 解析。
   ============================================================ */
(function () {
  'use strict';

  const log = [];
  const sleep = function (ms) { return new Promise(function (r) { setTimeout(r, ms); }); };

  function ok(name, cond, extra) {
    log.push((cond ? 'PASS' : 'FAIL') + ' | ' + name + (extra ? ' | ' + extra : ''));
  }

  function $(sel) { return document.querySelector(sel); }
  function $$(sel) { return Array.prototype.slice.call(document.querySelectorAll(sel)); }
  function fire(node, type) { node.dispatchEvent(new Event(type, { bubbles: true, cancelable: true })); }

  async function run() {
    await sleep(1000);

    /* ---------- 注册（未登录时先看到登录界面） ---------- */
    ok('未登录时显示登录/注册界面', $('#authScreen').hidden === false);
    ok('默认是登录页签', $('#authTabs [data-auth="login"]').getAttribute('aria-current') === 'page');
    ok('登录时看不到确认密码输入框', $('#authPwd2Field').hidden === true);
    $('#authTabs [data-auth="register"]').click();
    await sleep(80);
    ok('切到注册页签会要求确认密码', $('#authPwd2Field').hidden === false);

    // 两次密码不一致要能拦下来
    $('#authName').value = 'e2e用户';
    $('#authPwd').value = 'e2e-pass';
    $('#authPwd2').value = 'e2e-pass-x';
    fire($('#authForm'), 'submit');
    await sleep(150);
    ok('两次密码不一致会被拦下', $('#authMsg').textContent.indexOf('不一样') >= 0, $('#authMsg').textContent);
    ok('注册失败时仍停在登录界面', $('#authScreen').hidden === false);

    $('#authPwd2').value = 'e2e-pass';
    fire($('#authForm'), 'submit');
    await sleep(900);
    ok('注册成功后进入应用', $('#authScreen').hidden === true);
    ok('顶栏显示当前账号', $('#userBadge').hidden === false && $('#userBadge').textContent === 'e2e用户');
    ok('注册后是干净的新账号', $$('#logList .record').length === 0);
    ok('已登录时能看到退出按钮', $('#logoutBtn').hidden === false && $('#pwdBtn').hidden === false);

    /* ---------- 初始状态 ---------- */
    ok('初始无记录时显示空状态', $$('#logList .record').length === 0 && !!$('#logList .empty'));

    /* ---------- 新增 ---------- */
    $('#addBtn').click();
    await sleep(200);
    ok('点击新增后弹窗打开', $('#editor').open === true);
    ok('弹窗渲染了可选项目', $$('#fItems .chip').length >= 10, 'chips=' + $$('#fItems .chip').length);
    ok('弹窗渲染了强度按钮', $$('#fIntensity button').length === 5);

    $('#fDate').value = '2026-10-07';
    $('#fMinutes').value = '50';
    $('#fItems [data-pick="基本功"]').click();
    $('#fItems [data-pick="型・套路"]').click();
    $('#fIntensity [data-i="4"]').click();
    $('#fContent').value = '测试内容 A';
    $('#fInsight').value = '测试心得';
    $('#fEffect').value = '测试效果';
    $('#fTags').value = '早课, 测试';
    ok('项目选中状态生效', $$('#fItems .chip[aria-pressed="true"]').length === 2);

    /* ---------- 子项目 ---------- */
    ok('选中项目后出现子项目行', $$('#fSubItems .sub-row').length === 2, 'rows=' + $$('#fSubItems .sub-row').length);
    const basicRow = $('#fSubItems .sub-row[data-row="基本功"]');
    ok('子项目行列出了默认子项目', !!basicRow && basicRow.textContent.indexOf('马步冲拳') >= 0);
    basicRow.querySelector('[data-sub="马步冲拳"]').click();
    await sleep(80);
    // 勾选会重绘子项目区域，必须重新取元素再断言
    ok('子项目可勾选',
      $('#fSubItems .sub-row[data-row="基本功"] [data-sub="马步冲拳"]').getAttribute('aria-pressed') === 'true');
    $('#fSubItems .sub-row[data-row="基本功"] [data-newsub]').value = '弓步冲拳';
    $('#fSubItems .sub-row[data-row="基本功"] [data-addsub]').click();
    await sleep(250);
    ok('弹窗内可新建子项目', !!$('#fSubItems .sub-row[data-row="基本功"] [data-sub="弓步冲拳"]'));
    ok('新建的子项目自动选中',
      $('#fSubItems .sub-row[data-row="基本功"] [data-sub="弓步冲拳"]').getAttribute('aria-pressed') === 'true');
    ok('新建的子项目写入了项目树',
      window.TRCore.itemChildren(window.Store.get().settings.items, '基本功').indexOf('弓步冲拳') >= 0);

    fire($('#editorForm'), 'submit');
    await sleep(350);

    ok('提交后弹窗关闭', $('#editor').open === false);
    let cards = $$('#logList .record');
    ok('新记录出现在列表', cards.length === 1, 'cards=' + cards.length);
    ok('卡片含心得与效果', !!cards[0] && cards[0].textContent.indexOf('测试心得') >= 0 && cards[0].textContent.indexOf('测试效果') >= 0);
    ok('卡片显示时长 50 分钟', !!cards[0] && cards[0].textContent.indexOf('50') >= 0);
    ok('卡片显示「项目 › 子项目」', !!cards[0] && cards[0].textContent.indexOf('基本功 › 马步冲拳') >= 0);
    ok('摘要统计为 1 次', $('#logSummary .stat-card b').textContent.trim() === '1 次');
    ok('筛选按钮出现项目', $$('#filterChips .chip').length === 2);

    /* ---------- 搜索 / 筛选 ---------- */
    const search = $('#searchInput');
    search.value = '不存在的关键词';
    fire(search, 'input');
    await sleep(80);
    ok('搜索无结果时显示空态', $$('#logList .record').length === 0 && !!$('#logList .empty'));
    search.value = '测试心得';
    fire(search, 'input');
    await sleep(80);
    ok('搜索心得可命中', $$('#logList .record').length === 1);
    search.value = '';
    fire(search, 'input');
    await sleep(80);

    $('#filterChips .chip').click();
    await sleep(80);
    ok('按项目筛选生效', $$('#logList .record').length === 1 && $('#filterChips .chip').getAttribute('aria-pressed') === 'true');
    $('#filterChips .chip').click();
    await sleep(80);
    ok('再次点击取消筛选', $('#filterChips .chip').getAttribute('aria-pressed') === 'false');

    /* ---------- 编辑 ---------- */
    $('#logList .rec-edit[data-act="edit"]').click();
    await sleep(200);
    ok('编辑时带入原数据', $('#fMinutes').value === '50' && $('#fContent').value === '测试内容 A');
    ok('编辑时显示删除按钮', $('#deleteBtn').hidden === false);
    $('#fMinutes').value = '65';
    $('#fItems [data-pick="型・套路"]').click();     // 取消一个项目
    fire($('#editorForm'), 'submit');
    await sleep(350);
    ok('编辑后时长更新为 65', $('#logList .record .metric b').textContent.trim() === '65');
    ok('编辑后项目减少为一个', $$('#logList .record .tag-pill').length === 1);

    $('#logList .rec-edit[data-act="edit"]').click();
    await sleep(220);
    ok('再次编辑时子项目已回填',
      $('#fSubItems .sub-row[data-row="基本功"] [data-sub="马步冲拳"]').getAttribute('aria-pressed') === 'true');
    $('#cancelBtn').click();
    await sleep(150);

    /* ---------- 复制 ---------- */
    $('#logList .rec-edit[data-act="dup"]').click();
    await sleep(200);
    ok('复制时日期为今天', $('#fDate').value === window.TRCore.todayISO());
    $('#cancelBtn').click();
    await sleep(150);

    /* ---------- 日历 ---------- */
    $('.tab[data-view="calendar"]').click();
    await sleep(200);
    ok('切换到日历视图', $('#view-calendar').hidden === false && $('#view-log').hidden === true);
    ok('URL hash 同步', location.hash === '#calendar');
    ok('日历标题为 2026年10月', $('#calTitle').textContent.indexOf('2026年10月') >= 0, $('#calTitle').textContent);
    ok('日历 7 列星期表头', $$('#calWeekdays div').length === 7);
    ok('日历格子数是 7 的倍数', $$('#calGrid .cal-cell').length % 7 === 0, 'cells=' + $$('#calGrid .cal-cell').length);
    const trained = $('#calGrid .cal-cell.trained');
    ok('训练日有标记与时长', !!trained && trained.querySelector('.mins').textContent.trim() === '65′',
      trained ? trained.querySelector('.mins').textContent : 'none');
    trained.click();
    await sleep(150);
    ok('点选日期后面板显示该日记录', $$('#calDayPanel .record').length === 1);
    ok('面板显示日期标题', $('#calDayPanel h3').textContent.indexOf('2026年10月7日') >= 0);

    /* ---------- 统计 ---------- */
    $('.tab[data-view="stats"]').click();
    await sleep(200);
    ok('統計页 KPI 数量', $$('#kpiGrid .kpi').length >= 10, 'kpi=' + $$('#kpiGrid .kpi').length);
    ok('統計页训练次数为 1', $('#kpiGrid .kpi b').textContent.trim() === '1');
    ok('項目分布只有一项', $$('#itemBars .bar-row:not(.sub)').length === 1);
    ok('項目分布含子项目行', $$('#itemBars .bar-row.sub').length >= 1, 'sub=' + $$('#itemBars .bar-row.sub').length);
    ok('子项目行显示项目名', ($('#itemBars .bar-row.sub .name') || {}).textContent === '马步冲拳',
      ($('#itemBars .bar-row.sub .name') || {}).textContent);
    ok('項目分布进度条有宽度', ($('#itemBars .fill') || {}).style !== undefined && $('#itemBars .fill').style.width !== '');
    ok('热力图为 12 周 × 7 天', $$('#heatmap i').length === 84, 'cells=' + $$('#heatmap i').length);
    ok('近 30 天柱状图为 30 根', $$('#barChart .col').length === 30);
    ok('30 天内有柱子高度大于 0', $$('#barChart .col span').some(function (s) { return parseFloat(s.style.height) > 3; }));

    /* ---------- 设置 ---------- */
    $('.tab[data-view="settings"]').click();
    await sleep(200);
    ok('项目管理列出全部项目', $$('#itemManager [data-remove]').length === window.Store.get().settings.items.length);
    ok('项目树显示子项目', $$('#itemManager .item-node .children .chip').length > 10,
      'children=' + $$('#itemManager .item-node .children .chip').length);
    $('#newItemInput').value = '擒拿';
    fire($('#addItemForm'), 'submit');
    await sleep(150);
    ok('新增项目成功', !!$('#itemManager [data-remove="擒拿"]'));
    const powerNode = $('#itemManager .item-node[data-node="力量训练"]');
    powerNode.querySelector('[data-newsub2]').value = '双杠臂屈伸';
    powerNode.querySelector('[data-addsub2]').click();
    await sleep(200);
    ok('设置页可给项目加子项目', !!$('#itemManager .item-node[data-node="力量训练"] [data-remove-sub="双杠臂屈伸"]'));
    ok('存储状态已显示', $('#storeInfo').textContent.indexOf('文件存储模式') >= 0);
    ok('导出 CSV 含子项目列', window.TRCore.toCSV(window.Store.get().records).indexOf('项目,子项目,时长(分)') > 0);
    ok('导出 Markdown 含心得', window.TRCore.toMarkdown(window.Store.get().records, window.Store.get()).indexOf('测试心得') >= 0);
    ok('导出 Markdown 含子项目', window.TRCore.toMarkdown(window.Store.get().records, window.Store.get()).indexOf('基本功›马步冲拳') >= 0);

    /* ---------- 主题 ---------- */
    $('#themeBtn').click();
    await sleep(150);
    const theme = document.documentElement.getAttribute('data-theme');
    ok('切换主题生效', theme === 'light' || theme === 'dark', 'theme=' + theme);
    $('#themeBtn').click();
    await sleep(150);

    /* ---------- 删除 + 落盘 ---------- */
    window.confirm = function () { return true; };
    $('.tab[data-view="log"]').click();
    await sleep(200);
    $('#logList .rec-edit[data-act="edit"]').click();
    await sleep(200);
    $('#deleteBtn').click();
    await sleep(500);
    ok('删除后列表为空', $$('#logList .record').length === 0);

    let saved = null;
    try {
      saved = await (await fetch('api/data', { cache: 'no-store' })).json();
    } catch (e) { saved = null; }
    ok('已保存到本账号数据文件', !!saved && saved.records.length === 0, saved ? 'records=' + saved.records.length : 'fetch failed');
    ok('保存包含新增项目「擒拿」', !!saved && saved.settings.items.some(function (n) { return n.name === '擒拿'; }));
    ok('保存的项目树带子项目', !!saved && window.TRCore.itemChildren(saved.settings.items, '力量训练').indexOf('双杠臂屈伸') >= 0);

    /* ---------- 快捷键 ---------- */
    fire(document, 'keydown');
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'n', bubbles: true }));
    await sleep(200);
    ok('快捷键 N 打开新增弹窗', $('#editor').open === true);
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    await sleep(200);
    ok('Esc 关闭弹窗', $('#editor').open === false);

    /* ---------- 退出登录 / 重新登录 ---------- */
    window.confirm = function () { return true; };
    $('#logoutBtn').click();
    await sleep(700);
    ok('退出后回到登录界面', $('#authScreen').hidden === false);
    ok('退出后不再显示账号名', $('#userBadge').hidden === true);
    ok('退出后看不到任何记录', $$('#logList .record').length === 0);

    // 密码输错要给出提示
    $('#authTabs [data-auth="login"]').click();
    $('#authName').value = 'e2e用户';
    $('#authPwd').value = 'wrong-pass';
    fire($('#authForm'), 'submit');
    await sleep(700);
    ok('密码错误会提示且仍在登录界面',
      $('#authScreen').hidden === false && $('#authMsg').textContent.indexOf('不对') >= 0, $('#authMsg').textContent);

    $('#authPwd').value = 'e2e-pass';
    fire($('#authForm'), 'submit');
    await sleep(1000);
    ok('重新登录成功', $('#authScreen').hidden === true);
    ok('重新登录后账号名正确', $('#userBadge').textContent === 'e2e用户');
    ok('重新登录后项目树还在（数据确实落盘）',
      window.TRCore.itemChildren(window.Store.get().settings.items, '力量训练').indexOf('双杠臂屈伸') >= 0);
  }

  window.addEventListener('load', function () {
    run().catch(function (err) {
      log.push('FAIL | 运行异常 | ' + (err && err.stack ? err.stack.split('\n')[0] : err));
    }).then(function () {
      const pre = document.createElement('pre');
      pre.id = 'e2e-result';
      pre.textContent = 'E2E-BEGIN\n' + log.join('\n') + '\nE2E-END';
      document.body.appendChild(pre);
      document.title = 'E2E-DONE';
    });
  });
})();
