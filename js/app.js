/* ============================================================
   体術修煉 · app.js
   视图层：記録 / 日暦 / 統計 / 設定 四个视图 + 编辑弹窗。
   ============================================================ */
(function () {
  'use strict';

  const Core = window.TRCore;
  const Store = window.Store;
  const $ = function (id) { return document.getElementById(id); };

  const ui = {
    view: 'log',
    query: '',
    item: '',
    sort: 'desc',
    range: 'all',
    calYear: 0,
    calMonth: 0,
    calSelected: '',
    editingId: null,
    formItems: [],
    formItemCounts: {},
    formSubItems: [],
    formIntensity: 0
  };

  /* ------------------------------ 小工具 ------------------------------ */

  let toastTimer = null;
  function toast(message) {
    const node = $('toast');
    node.textContent = message;
    node.classList.add('show');
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { node.classList.remove('show'); }, 2400);
  }

  function download(filename, text, mime) {
    const blob = new Blob([text], { type: mime || 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(function () { URL.revokeObjectURL(url); a.remove(); }, 200);
  }

  function stamp() { return Core.todayISO().replace(/-/g, ''); }

  function intensityDots(n) {
    if (!n) return '';
    return '●'.repeat(n) + '○'.repeat(Math.max(0, 5 - n));
  }

  function rangeFrom() {
    if (ui.range === 'all') return '';
    return Core.addDays(Core.todayISO(), -(Number(ui.range) - 1));
  }

  function visibleRecords() {
    return Core.filterRecords(Store.get().records, {
      query: ui.query, item: ui.item, from: rangeFrom()
    });
  }

  /* ------------------------------ 主渲染 ------------------------------ */

  function renderActive() {
    applyTheme(Store.get().settings.theme);
    renderBadge();
    if (ui.view === 'log') renderLog();
    else if (ui.view === 'calendar') renderCalendar();
    else if (ui.view === 'stats') renderStats();
    else if (ui.view === 'settings') renderSettings();
  }

  function applyTheme(theme) {
    document.documentElement.setAttribute('data-theme', theme === 'light' ? 'light' : 'dark');
  }

  function renderBadge() {
    const badge = $('storeBadge');
    const fileMode = Store.getMode() === 'file';
    badge.className = 'badge ' + (fileMode ? 'file' : 'local');
    badge.textContent = fileMode ? '● 文件存储' : '● 浏览器存储';
    badge.title = Store.getNote();

    const auth = Store.getAuth();
    const userBadge = $('userBadge');
    const signedIn = !!(auth.user);
    userBadge.hidden = !signedIn;
    userBadge.textContent = signedIn ? auth.user.name : '';
    userBadge.title = signedIn
      ? '当前账号：' + auth.user.name + (auth.dataFile ? '（数据文件 ' + auth.dataFile + '）' : '')
      : '';
    $('logoutBtn').hidden = !signedIn;
    $('pwdBtn').hidden = !signedIn;
  }

  /* ------------------------------ 登录 / 注册 ------------------------------ */

  let authMode = 'login';

  function renderAuthScreen() {
    const auth = Store.getAuth();
    const needAuth = auth.required && !auth.user;
    $('authScreen').hidden = !needAuth;
    if (!needAuth) return;
    $('authSubmit').textContent = authMode === 'login' ? '登录' : '注册并开始记录';
    $('authPwd2Field').hidden = authMode !== 'register';
    $('authPwd').setAttribute('autocomplete', authMode === 'login' ? 'current-password' : 'new-password');
    $('authHint').textContent = authMode === 'login'
      ? '第一次使用请点上面的「注册」。账号只保存在你自己的电脑上。'
      : '注册只要用户名和密码，密码 1 位也可以；会用 scrypt 加盐散列后保存，不存明文。';
  }

  function setAuthMode(next) {
    authMode = next === 'register' ? 'register' : 'login';
    Array.prototype.forEach.call($('authTabs').querySelectorAll('button'), function (b) {
      if (b.dataset.auth === authMode) b.setAttribute('aria-current', 'page');
      else b.removeAttribute('aria-current');
    });
    $('authMsg').textContent = '';
    $('authMsg').className = 'auth-msg';
    renderAuthScreen();
    setTimeout(function () { $('authName').focus(); }, 40);
  }

  function authMessage(text, ok) {
    const node = $('authMsg');
    node.textContent = text || '';
    node.className = 'auth-msg' + (ok ? ' ok' : '');
  }

  async function submitAuth(event) {
    event.preventDefault();
    const name = $('authName').value.trim();
    const pwd = $('authPwd').value;
    if (!name || !pwd) { authMessage('请填写用户名和密码'); return; }
    if (authMode === 'register') {
      if (!pwd) { authMessage('请输入密码'); return; }
      if (pwd !== $('authPwd2').value) { authMessage('两次输入的密码不一样'); return; }
    }
    $('authSubmit').disabled = true;
    try {
      const res = authMode === 'register' ? await Store.register(name, pwd) : await Store.login(name, pwd);
      if (!res.ok) { authMessage(res.error || '操作失败'); return; }
      $('authPwd').value = '';
      $('authPwd2').value = '';
      authMessage('');
      $('authScreen').hidden = true;
      renderActive();
      const adopted = res.adopted ? '，已接管原有 ' + res.adopted + ' 条记录' : '';
      toast((authMode === 'register' ? '注册成功，欢迎 ' : '欢迎回来，') + res.user.name + adopted);
    } catch (err) {
      authMessage('连接服务失败：' + (err && err.message ? err.message : err));
    } finally {
      $('authSubmit').disabled = false;
    }
  }

  async function doLogout() {
    if (!confirm('退出登录？退出后需要重新输入用户名和密码才能看到记录。')) return;
    await Store.logout();
    authMode = 'login';
    setAuthMode('login');
    authMessage('');
    renderActive();
    toast('已退出登录');
  }

  function openPwdDialog() {
    $('pwdOld').value = '';
    $('pwdNew').value = '';
    $('pwdNew2').value = '';
    $('pwdMsg').textContent = '';
    const dlg = $('pwdDialog');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    setTimeout(function () { $('pwdOld').focus(); }, 40);
  }

  function closePwdDialog() {
    const dlg = $('pwdDialog');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
  }

  async function submitPwd(event) {
    event.preventDefault();
    const oldPwd = $('pwdOld').value;
    const next = $('pwdNew').value;
    if (!next) { $('pwdMsg').textContent = '请输入新密码'; return; }
    if (next !== $('pwdNew2').value) { $('pwdMsg').textContent = '两次输入的新密码不一样'; return; }
    const res = await Store.changePassword(oldPwd, next);
    if (!res.ok) { $('pwdMsg').textContent = res.error || '修改失败'; return; }
    closePwdDialog();
    toast('密码已修改');
  }

  /* ------------------------------ 記録 视图 ------------------------------ */

  function renderLog() {
    renderLogSummary();
    renderFilterChips();
    renderLogList();
  }

  function renderLogSummary() {
    const list = visibleRecords();
    const stats = Core.computeStats(list);
    const cards = [
      ['训练次数', stats.count + ' 次'],
      ['累计时长', (Math.round(stats.totalMinutes / 6) / 10) + ' 小时'],
      ['平均每次', stats.avgMinutes + ' 分'],
      ['当前连续', stats.streak + ' 天'],
      ['本月', stats.month.count + ' 次 / ' + stats.month.minutes + ' 分']
    ];
    if (stats.totalReps) cards.push(['累计个数', stats.totalReps + ' 个']);
    $('logSummary').innerHTML = cards.map(function (pair) {
      return '<div class="stat-card"><b>' + Core.esc(pair[1]) + '</b><span>' + Core.esc(pair[0]) + '</span></div>';
    }).join('');
  }

  function renderFilterChips() {
    const host = $('filterChips');
    const used = new Map();
    Store.get().records.forEach(function (r) {
      r.items.forEach(function (name) { used.set(name, (used.get(name) || 0) + 1); });
    });
    const names = Array.from(used.keys()).sort(function (a, b) { return used.get(b) - used.get(a); });
    if (!names.length) { host.innerHTML = ''; return; }
    host.innerHTML = names.map(function (name) {
      return '<button class="chip" data-item="' + Core.esc(name) + '" aria-pressed="'
        + (ui.item === name) + '">' + Core.esc(name) + '<span class="x">' + used.get(name) + '</span></button>';
    }).join('');
  }

  function recordCardHTML(r) {
    const d = Core.parseISO(r.date);
    const parts = [];
    parts.push('<div class="record-date"><b>' + Core.pad2(d ? d.getDate() : 0) + '</b>'
      + '<span>周' + Core.esc(Core.weekdayCN(r.date)) + '</span>'
      + '<em>' + (d ? d.getFullYear() + '.' + Core.pad2(d.getMonth() + 1) : '') + '</em></div>');

    const metrics = [];
    if (r.minutes) metrics.push('<span class="metric"><b>' + r.minutes + '</b> 分钟</span>');
    const total = Core.totalCount(r);
    if (total) metrics.push('<span class="metric"><b>' + total + '</b> 个</span>');
    if (r.intensity) metrics.push('<span class="metric">强度 <b>' + intensityDots(r.intensity) + '</b></span>');
    if (r.condition) metrics.push('<span class="metric">' + Core.esc(r.condition) + '</span>');

    const blocks = [];
    if (r.content) blocks.push('<div class="rec-block"><i>内容</i><div>' + Core.esc(r.content) + '</div></div>');
    if (r.insight) blocks.push('<div class="rec-block"><i>心得</i><div>' + Core.esc(r.insight) + '</div></div>');
    if (r.effect) blocks.push('<div class="rec-block"><i>效果</i><div>' + Core.esc(r.effect) + '</div></div>');

    const subPills = (r.subItems || []).map(function (s) {
      return '<span class="sub-pill">' + (s.parent ? Core.esc(s.parent) + ' › ' : '') + Core.esc(s.name)
        + (s.count ? '<span class="n">×' + s.count + '</span>' : '') + '</span>';
    }).join('');

    return '<article class="record" data-id="' + Core.esc(r.id) + '">'
      + parts.join('')
      + '<div class="record-main">'
      + '<div class="record-top">'
      + '<div class="rec-items">' + (r.items.length
        ? r.items.map(function (n) {
            const c = r.itemCounts && r.itemCounts[n];
            return '<span class="tag-pill">' + Core.esc(n) + (c ? '<span class="n">×' + c + '</span>' : '') + '</span>';
          }).join('')
        : '<span class="metric">未分类</span>') + '</div>'
      + '<span class="spacer"></span>'
      + metrics.join('')
      + '</div>'
      + (subPills ? '<div class="rec-items">' + subPills + '</div>' : '')
      + blocks.join('')
      + (r.tags.length ? '<div class="rec-items">' + r.tags.map(function (t) {
          return '<span class="metric">#' + Core.esc(t) + '</span>';
        }).join('') + '</div>' : '')
      + '<div class="rec-items"><span class="rec-actions">'
      + '<button class="rec-edit" data-act="edit">编辑</button>'
      + '<button class="rec-edit" data-act="dup">复制</button>'
      + '</span></div>'
      + '</div></article>';
  }

  function renderLogList() {
    const list = visibleRecords();
    const host = $('logList');
    if (!list.length) {
      const hasAny = Store.get().records.length > 0;
      host.innerHTML = '<div class="empty"><b>' + (hasAny ? '没有符合条件的记录' : '还没有训练记录') + '</b>'
        + (hasAny ? '换个关键词或清空筛选试试。' : '点击右上角「＋ 新增記録」，记下今天的修炼。')
        + '</div>';
      return;
    }
    const groups = Core.groupByMonth(list, ui.sort);
    host.innerHTML = groups.map(function (g) {
      const minutes = g.records.reduce(function (s, r) { return s + Core.num(r.minutes); }, 0);
      return '<section class="month-group"><h3><b>' + Core.esc(g.label) + '</b>'
        + g.records.length + ' 次 · ' + minutes + ' 分钟</h3>'
        + '<div class="records">' + g.records.map(recordCardHTML).join('') + '</div></section>';
    }).join('');
  }

  /* ------------------------------ 日暦 视图 ------------------------------ */

  function renderCalendar() {
    const today = Core.todayISO();
    if (!ui.calYear) {
      const d = Core.parseISO(today);
      ui.calYear = d.getFullYear();
      ui.calMonth = d.getMonth() + 1;
    }
    $('calTitle').textContent = ui.calYear + '年' + ui.calMonth + '月';

    $('calWeekdays').innerHTML = Core.WEEKDAYS.map(function (w) { return '<div>周' + w + '</div>'; }).join('');

    const byDay = Core.minutesByDate(Store.get().records);
    const recordsByDay = new Map();
    Store.get().records.forEach(function (r) {
      if (!recordsByDay.has(r.date)) recordsByDay.set(r.date, []);
      recordsByDay.get(r.date).push(r);
    });

    const weeks = Core.monthMatrix(ui.calYear, ui.calMonth);
    $('calGrid').innerHTML = weeks.map(function (week) {
      return week.map(function (cell) {
        const minutes = byDay.get(cell.iso) || 0;
        const recs = recordsByDay.get(cell.iso) || [];
        const cls = ['cal-cell'];
        if (!cell.inMonth) cls.push('out');
        if (cell.iso === today) cls.push('today');
        if (cell.iso === ui.calSelected) cls.push('selected');
        if (minutes > 0) cls.push('trained');
        const dots = recs.slice(0, 5).map(function () { return '<i></i>'; }).join('');
        return '<div class="' + cls.join(' ') + '" data-date="' + cell.iso + '" title="'
          + Core.esc(Core.formatDateCN(cell.iso) + (minutes ? ' · ' + minutes + ' 分钟' : '')) + '">'
          + '<span class="d">' + cell.day + '</span>'
          + (minutes ? '<span class="bars-mini">' + dots + '</span><span class="mins">' + minutes + '<small>′</small></span>' : '')
          + '</div>';
      }).join('');
    }).join('');

    renderCalDayPanel();
  }

  function renderCalDayPanel() {
    const host = $('calDayPanel');
    if (!ui.calSelected) {
      host.innerHTML = '<div class="empty"><b>点一个日期</b>查看那天的训练详情，或直接在日历上选日期新增记录。</div>';
      return;
    }
    const recs = Store.get().records.filter(function (r) { return r.date === ui.calSelected; });
    const total = recs.reduce(function (s, r) { return s + Core.num(r.minutes); }, 0);
    host.innerHTML = '<div class="panel"><h3>' + Core.esc(Core.formatDateCN(ui.calSelected))
      + '（周' + Core.esc(Core.weekdayCN(ui.calSelected)) + '）</h3>'
      + '<p class="hint">' + (recs.length ? recs.length + ' 条记录 · 共 ' + total + ' 分钟' : '这天还没有记录') + '</p>'
      + '<div class="row"><button class="btn primary sm" data-new-on="' + ui.calSelected + '">在这天新增</button></div>'
      + '</div>'
      + (recs.length ? '<div class="log-list">' + Core.sortRecords(recs, 'desc').map(recordCardHTML).join('') + '</div>' : '');
  }

  /* ------------------------------ 統計 视图 ------------------------------ */

  function renderStats() {
    const records = Store.get().records;
    const stats = Core.computeStats(records);
    const kpi = $('kpiGrid');

    if (!records.length) {
      kpi.innerHTML = '<div class="kpi"><b>0</b><span>训练次数</span></div>';
      $('itemBars').innerHTML = '<p class="hint">还没有数据，先去記録页添加一条吧。</p>';
      $('heatmap').innerHTML = '';
      $('heatLegend').textContent = '';
      $('barChart').innerHTML = '';
      return;
    }

    const deltaCount = stats.month.count - stats.prevMonth.count;
    const deltaMin = stats.month.minutes - stats.prevMonth.minutes;
    const deltaHTML = function (value, unit) {
      const cls = value > 0 ? 'up' : (value < 0 ? 'down' : '');
      const sign = value > 0 ? '+' : '';
      return '<div class="delta ' + cls + '">较上月 ' + sign + value + ' ' + unit + '</div>';
    };

    kpi.innerHTML = [
      '<div class="kpi"><b>' + stats.count + '</b><span>训练次数</span></div>',
      '<div class="kpi"><b>' + (Math.round(stats.totalMinutes / 6) / 10) + '<small>小时</small></b><span>累计时长 · ' + stats.totalMinutes + ' 分钟</span></div>',
      '<div class="kpi"><b>' + stats.trainingDays + '<small>天</small></b><span>训练天数</span></div>',
      '<div class="kpi"><b>' + stats.streak + '<small>天</small></b><span>当前连续</span></div>',
      '<div class="kpi"><b>' + stats.longestStreak + '<small>天</small></b><span>最长连续</span></div>',
      '<div class="kpi"><b>' + stats.month.count + '<small>次</small></b><span>' + Core.formatMonthCN(stats.month.key) + '训练</span>' + deltaHTML(deltaCount, '次') + '</div>',
      '<div class="kpi"><b>' + stats.month.minutes + '<small>分</small></b><span>本月时长</span>' + deltaHTML(deltaMin, '分钟') + '</div>',
      '<div class="kpi"><b>' + stats.avgMinutes + '<small>分</small></b><span>平均每次时长</span></div>',
      '<div class="kpi"><b>' + (stats.avgIntensity || '—') + '<small>/5</small></b><span>平均体感强度</span></div>',
      (stats.totalReps ? '<div class="kpi"><b>' + stats.totalReps + '<small>个</small></b><span>累计个数</span></div>' : ''),
      '<div class="kpi"><b>' + stats.activeItems + '<small>项</small></b><span>涉及训练项目</span></div>',
      (stats.activeSubItems ? '<div class="kpi"><b>' + stats.activeSubItems + '<small>项</small></b><span>涉及子项目</span></div>' : ''),
      '<div class="kpi"><b>' + stats.last30Minutes + '<small>分</small></b><span>近 30 天时长</span></div>'
    ].join('');

    const top = stats.byItem.slice(0, 9);
    const maxCount = top.length ? top[0].count : 1;
    const barRow = function (name, count, minutes, isSub, reps) {
      const pct = Math.max(4, Math.round(count / maxCount * 100));
      return '<div class="bar-row' + (isSub ? ' sub' : '') + '">'
        + '<span class="name" title="' + Core.esc(name) + '">' + Core.esc(name) + '</span>'
        + '<span class="track"><span class="fill" style="width:' + pct + '%"></span></span>'
        + '<span class="val">' + count + ' 次 · ' + minutes + '′' + (reps ? ' · ' + reps + ' 个' : '') + '</span></div>';
    };
    $('itemBars').innerHTML = top.map(function (x) {
      const subs = stats.subItemsOf(x.name).slice(0, 6).map(function (s) {
        return barRow(s.name, s.count, s.minutes, true, s.reps);
      }).join('');
      return barRow(x.name, x.count, x.minutes, false, x.reps) + subs;
    }).join('');

    const weeks = Core.heatmap(records, stats.today, 12);
    $('heatmap').innerHTML = weeks.map(function (week) {
      return week.map(function (day) {
        return '<i data-l="' + day.level + '" title="' + Core.esc(day.date + ' · ' + day.minutes + ' 分钟') + '"></i>';
      }).join('');
    }).join('');
    $('heatLegend').textContent = '左→右为每周一至周日（由早到晚），颜色越深训练时长越长；每格代表一天，最多 90 分钟以上为最深。';

    const maxMin = Math.max.apply(null, stats.last30.map(function (d) { return d.minutes; }).concat([1]));
    $('barChart').innerHTML = stats.last30.map(function (d) {
      const h = d.minutes ? Math.max(3, Math.round(d.minutes / maxMin * 100)) : 2;
      return '<div class="col" title="' + Core.esc(d.date + ' · ' + d.minutes + ' 分钟 · ' + d.count + ' 次') + '">'
        + '<span style="height:' + h + '%;' + (d.minutes ? '' : 'opacity:.25') + '"></span></div>';
    }).join('');
  }

  /* ------------------------------ 設定 视图 ------------------------------ */

  function renderSettings() {
    const state = Store.get();
    const tree = Core.normalizeItems(state.settings.items);
    $('itemManager').innerHTML = tree.map(function (node) {
      const children = node.children.map(function (child) {
        return '<button class="chip plain" data-remove-sub="' + Core.esc(child) + '" data-parent="' + Core.esc(node.name) + '" title="删除子项目">'
          + Core.esc(child) + '<span class="x">✕</span></button>';
      }).join('');
      return '<div class="item-node" data-node="' + Core.esc(node.name) + '">'
        + '<div class="node-head"><span class="node-name">' + Core.esc(node.name) + '</span>'
        + '<span class="node-count">' + node.children.length + ' 个子项目</span>'
        + '<span class="spacer"></span>'
        + '<button class="rec-edit" data-remove="' + Core.esc(node.name) + '">删除项目</button></div>'
        + '<div class="children">' + children + '</div>'
        + '<div class="add-sub"><input type="text" maxlength="20" placeholder="给「' + Core.esc(node.name) + '」添加子项目，回车确认" data-newsub2="1">'
        + '<button type="button" data-addsub2="' + Core.esc(node.name) + '">添加</button></div>'
        + '</div>';
    }).join('') || '<span class="hint">还没有项目。</span>';

    const fileMode = Store.getMode() === 'file';
    const auth = Store.getAuth();
    const lines = [];
    lines.push('<b>' + (fileMode ? '文件存储模式' : '浏览器存储模式') + '</b>');
    if (fileMode) {
      lines.push('当前账号：<b>' + Core.esc(auth.user ? auth.user.name : '未登录') + '</b>'
        + (auth.dataFile ? ' · 数据文件 <code>' + Core.esc(auth.dataFile) + '</code>' : ''));
      lines.push('账号信息在 <code>data/users.json</code>（密码是 scrypt 加盐散列，不存明文）；每个账号一份数据文件，互不可见。');
      lines.push('可用网盘、U 盘或 Git 备份整个 <code>data/</code> 目录；局域网内其他设备访问同一地址即可登录自己的账号。');
    } else {
      lines.push('直接打开 index.html（file://）时没有账号功能，数据存在当前浏览器里。清除浏览器数据会一并清除记录，请定期导出 JSON 备份。');
      lines.push('想要账号系统：关闭本页，双击 <code>启动.bat</code>（或在目录里执行 <code>node server.mjs</code>），再从 <code>http://127.0.0.1:4173</code> 打开。');
    }
    const subTotal = tree.reduce(function (sum, n) { return sum + n.children.length; }, 0);
    lines.push('当前记录：' + state.records.length + ' 条 · 项目 ' + tree.length + ' 个 · 子项目 ' + subTotal + ' 个。');
    if (Store.getNote()) lines.push('<i>' + Core.esc(Store.getNote()) + '</i>');
    $('storeInfo').innerHTML = lines.join('<br>');
  }

  /* ------------------------------ 编辑弹窗 ------------------------------ */

  function renderFormItems() {
    const tree = Core.normalizeItems(Store.get().settings.items);
    const names = Core.uniqueStrings(Core.itemNames(tree).concat(ui.formItems), 30);
    syncItemCountsFromDOM();
    $('fItems').innerHTML = names.map(function (name) {
      const on = ui.formItems.indexOf(name) >= 0;
      const kids = Core.itemChildren(tree, name).length;
      const title = kids
        ? kids + ' 个子项目 · 个数填在子项目上'
        : (on ? '没有子项目，直接填个数' : '没有子项目，勾选后可填个数');
      const chip = '<button type="button" class="chip" data-pick="' + Core.esc(name) + '" aria-pressed="' + on + '" title="'
        + Core.esc(title) + '">'
        + Core.esc(name) + (kids ? '<span class="x">' + kids + '</span>' : '') + '</button>';
      let inner = chip;
      // 没有子项目的项目：勾选后直接给它一个「个数」输入框
      if (on && !kids) {
        const c = ui.formItemCounts[name] || '';
        inner += '<input type="number" class="count-input item-count" data-item-count="' + Core.esc(name)
          + '" min="0" max="99999" step="1" inputmode="numeric" placeholder="个数" title="个数（个 / 次）" value="' + c + '">';
      }
      // 勾选后可以从项目清单里删除它
      if (on) {
        inner += '<button type="button" class="chip-del" data-del-item="' + Core.esc(name)
          + '" title="从项目清单删除「' + Core.esc(name) + '」" aria-label="删除项目">✕</button>';
      }
      return '<span class="pick-wrap">' + inner + '</span>';
    }).join('');
    renderFormSubItems(tree);
  }

  /* 从项目清单里删除一个项目（不影响已有记录的内容） */
  function deleteProject(name) {
    if (!name) return;
    if (!confirm('从项目清单里删除「' + name + '」？已有记录不会受影响。')) return;
    Store.removeItem(name);
    const i = ui.formItems.indexOf(name);
    if (i >= 0) ui.formItems.splice(i, 1);
    delete ui.formItemCounts[name];
    ui.formSubItems = ui.formSubItems.filter(function (s) { return s.parent !== name; });
    renderFormItems();
    toast('已从项目清单删除：' + name);
  }

  /* 从项目清单里删除一个子项目 */
  function deleteSubItem(parent, name) {
    if (!name) return;
    if (!confirm('从项目清单里删除子项目「' + parent + ' › ' + name + '」？已有记录不会受影响。')) return;
    Store.removeItem(name, parent);
    ui.formSubItems = ui.formSubItems.filter(function (s) {
      return !(s.parent === parent && s.name === name);
    });
    renderFormItems();
    toast('已从项目清单删除：' + parent + ' › ' + name);
  }

  /* 读取项目行里已填的个数，合并进 ui.formItemCounts（重绘前调用，避免丢值） */
  function syncItemCountsFromDOM() {
    Array.prototype.forEach.call($('fItems').querySelectorAll('.item-count'), function (input) {
      const name = input.dataset.itemCount;
      if (!name || ui.formItems.indexOf(name) < 0) return;   // 已取消勾选的项目不再回填
      const count = Core.clampInt(input.value, 0, 100000, 0);
      if (count > 0) ui.formItemCounts[name] = count;
      else delete ui.formItemCounts[name];
    });
  }

  /* 选中项目下面的子项目行：可以勾选已有的、填个数，也可以当场新建 */
  function renderFormSubItems(tree) {
    tree = tree || Core.normalizeItems(Store.get().settings.items);
    const host = $('fSubItems');
    // 重绘前记住已经打了一半的子项目名，重绘后填回去
    const typed = {};
    Array.prototype.forEach.call(host.querySelectorAll('.sub-row'), function (row) {
      const input = row.querySelector('[data-newsub]');
      if (input && input.value) typed[row.dataset.row] = input.value;
    });
    syncSubCountsFromDOM();

    host.innerHTML = ui.formItems.map(function (parentName) {
      const children = Core.itemChildren(tree, parentName);
      const chips = children.map(function (name) {
        const sel = ui.formSubItems.find(function (s) { return s.parent === parentName && s.name === name; });
        const on = !!sel;
        const chip = '<button type="button" class="chip" data-sub="' + Core.esc(name) + '" data-parent="' + Core.esc(parentName)
          + '" aria-pressed="' + on + '">' + Core.esc(name) + '</button>';
        let inner = chip;
        if (on) {
          const c = sel.count ? sel.count : '';
          inner += '<input type="number" class="count-input sub-count" data-sub-count="' + Core.esc(name)
            + '" data-parent="' + Core.esc(parentName) + '" min="0" max="99999" step="1" inputmode="numeric" placeholder="个数" title="个数（个 / 次）" value="' + c + '">';
          inner += '<button type="button" class="chip-del" data-del-sub="' + Core.esc(name)
            + '" data-parent="' + Core.esc(parentName) + '" title="从项目清单删除子项目「' + Core.esc(parentName) + ' › ' + Core.esc(name) + '」" aria-label="删除子项目">✕</button>';
        }
        return '<span class="sub-pick">' + inner + '</span>';
      }).join('');
      return '<div class="sub-row" data-row="' + Core.esc(parentName) + '">'
        + '<span class="sub-parent">' + Core.esc(parentName) + '</span>'
        + chips
        + '<span class="add-sub"><input type="text" maxlength="20" placeholder="＋ 添加子项目" data-newsub="1">'
        + '<button type="button" data-addsub="' + Core.esc(parentName) + '">添加</button></span>'
        + '</div>';
    }).join('');

    Array.prototype.forEach.call(host.querySelectorAll('.sub-row'), function (row) {
      const input = row.querySelector('[data-newsub]');
      if (input && typed[row.dataset.row]) input.value = typed[row.dataset.row];
    });
  }

  /* 读取子项目行里已填的个数，合并进 ui.formSubItems（重绘前调用，避免丢值） */
  function syncSubCountsFromDOM() {
    Array.prototype.forEach.call($('fSubItems').querySelectorAll('.sub-count'), function (input) {
      const parent = input.dataset.parent;
      const name = input.dataset.subCount;
      const hit = ui.formSubItems.find(function (s) { return s.parent === parent && s.name === name; });
      if (hit) hit.count = Core.clampInt(input.value, 0, 100000, 0);
    });
  }

  function isSubSelected(parent, name) {
    return ui.formSubItems.some(function (s) { return s.parent === parent && s.name === name; });
  }

  function addSubItem(parent, inputEl) {
    const name = String(inputEl && inputEl.value || '').trim().slice(0, 20);
    if (!name) return;
    const existed = Core.itemChildren(Store.get().settings.items, parent).indexOf(name) >= 0;
    const added = Store.addItem(name, parent);
    if (!isSubSelected(parent, name)) ui.formSubItems.push({ parent: parent, name: name, count: 0 });
    if (inputEl) inputEl.value = '';
    renderFormItems();
    toast(existed || !added ? '子项目已在列表中：' + name : '已添加：' + parent + ' › ' + name);
  }

  function renderIntensity() {
    $('fIntensity').innerHTML = [1, 2, 3, 4, 5].map(function (n) {
      return '<button type="button" role="radio" aria-checked="' + (ui.formIntensity === n) + '" data-i="' + n + '" title="'
        + Core.esc(Core.INTENSITY_LABEL[n]) + '">' + n + '</button>';
    }).join('') + '<em id="intensityHint">' + Core.esc(Core.INTENSITY_LABEL[ui.formIntensity] || '未设置') + '</em>';
  }

  function openEditor(record, presetDate) {
    const isEdit = !!(record && record.id);
    ui.editingId = isEdit ? record.id : null;
    ui.formItems = record && Array.isArray(record.items) ? record.items.slice() : [];
    ui.formSubItems = record && Array.isArray(record.subItems) ? record.subItems.map(function (s) {
      return { parent: s.parent, name: s.name, count: s.count || 0 };
    }) : [];
    ui.formItemCounts = {};
    if (record && record.itemCounts && typeof record.itemCounts === 'object') {
      Object.keys(record.itemCounts).forEach(function (k) { ui.formItemCounts[k] = record.itemCounts[k]; });
    }
    ui.formIntensity = record && record.intensity ? record.intensity : 0;

    $('editorTitle').textContent = isEdit ? '編輯訓練記録' : '新增訓練記録';
    $('fDate').value = (record && record.date) || presetDate || Core.todayISO();
    $('fMinutes').value = record && record.minutes ? record.minutes : '';
    $('fContent').value = (record && record.content) || '';
    $('fInsight').value = (record && record.insight) || '';
    $('fEffect').value = (record && record.effect) || '';
    $('fCondition').value = (record && record.condition) || '';
    $('fTags').value = record && record.tags ? record.tags.join(', ') : '';
    $('fItemCustom').value = '';
    $('deleteBtn').hidden = !isEdit;
    $('saveBtn').textContent = isEdit ? '保存修改' : '保存记录';

    renderFormItems();
    renderIntensity();
    const dlg = $('editor');
    if (typeof dlg.showModal === 'function') dlg.showModal();
    else dlg.setAttribute('open', '');
    setTimeout(function () { $('fContent').focus(); }, 40);
  }

  function closeEditor() {
    const dlg = $('editor');
    if (typeof dlg.close === 'function') dlg.close();
    else dlg.removeAttribute('open');
    ui.editingId = null;
  }

  function submitEditor(event) {
    event.preventDefault();
    const date = $('fDate').value;
    if (!Core.isValidISO(date)) { toast('请选择有效的日期'); return; }
    syncItemCountsFromDOM();
    syncSubCountsFromDOM();
    const itemCounts = {};
    ui.formItems.forEach(function (name) {
      const c = ui.formItemCounts[name];
      if (c > 0) itemCounts[name] = c;
    });
    const payload = {
      id: ui.editingId || undefined,
      date: date,
      items: ui.formItems,
      itemCounts: itemCounts,
      subItems: ui.formSubItems.filter(function (s) { return ui.formItems.indexOf(s.parent) >= 0; })
        .map(function (s) { return { parent: s.parent, name: s.name, count: s.count || 0 }; }),
      minutes: Core.clampInt($('fMinutes').value, 0, 1440, 0),
      intensity: ui.formIntensity,
      content: $('fContent').value.trim(),
      insight: $('fInsight').value.trim(),
      effect: $('fEffect').value.trim(),
      condition: $('fCondition').value,
      tags: Core.splitTags($('fTags').value)
    };
    if (!payload.items.length && !payload.content && !payload.minutes) {
      toast('至少填一个项目和时长，或者写点内容吧');
      return;
    }
    if (ui.editingId) {
      Store.updateRecord(payload);
      toast('已更新 ' + Core.formatDateCN(date) + ' 的记录');
    } else {
      Store.addRecord(payload);
      toast('已记录 ' + Core.formatDateCN(date) + ' 的修炼');
    }
    closeEditor();
  }

  /* ------------------------------ 事件绑定 ------------------------------ */

  function switchView(view) {
    if (['log', 'calendar', 'stats', 'settings'].indexOf(view) < 0) view = 'log';
    ui.view = view;
    Array.prototype.forEach.call(document.querySelectorAll('.tab'), function (t) {
      if (t.dataset.view === view) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    ['log', 'calendar', 'stats', 'settings'].forEach(function (v) {
      $('view-' + v).hidden = v !== view;
    });
    if (location.hash !== '#' + view) {
      try { history.replaceState(null, '', '#' + view); } catch (e) { location.hash = view; }
    }
    renderActive();
  }

  function bind() {
    // 顶部
    $('tabs').addEventListener('click', function (e) {
      const btn = e.target.closest('.tab');
      if (btn) switchView(btn.dataset.view);
    });
    $('addBtn').addEventListener('click', function () { openEditor(null, null); });
    $('authTabs').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-auth]');
      if (btn) setAuthMode(btn.dataset.auth);
    });
    $('authForm').addEventListener('submit', submitAuth);
    $('logoutBtn').addEventListener('click', doLogout);
    $('pwdBtn').addEventListener('click', openPwdDialog);
    $('pwdForm').addEventListener('submit', submitPwd);
    $('pwdClose').addEventListener('click', function (e) { e.preventDefault(); closePwdDialog(); });
    $('pwdCancel').addEventListener('click', function (e) { e.preventDefault(); closePwdDialog(); });
    $('themeBtn').addEventListener('click', function () {
      const next = Store.get().settings.theme === 'light' ? 'dark' : 'light';
      Store.setTheme(next);
      applyTheme(next);
      toast(next === 'light' ? '明亮模式' : '暗色模式');
    });

    // 記録
    $('searchInput').addEventListener('input', function (e) {
      ui.query = e.target.value;
      renderLogSummary(); renderLogList();
    });
    $('sortSelect').addEventListener('change', function (e) { ui.sort = e.target.value; renderLogList(); });
    $('rangeSelect').addEventListener('change', function (e) {
      ui.range = e.target.value; renderLogSummary(); renderLogList();
    });
    $('filterChips').addEventListener('click', function (e) {
      const chip = e.target.closest('.chip');
      if (!chip) return;
      ui.item = ui.item === chip.dataset.item ? '' : chip.dataset.item;
      renderFilterChips(); renderLogSummary(); renderLogList();
    });
    $('logList').addEventListener('click', function (e) {
      const btn = e.target.closest('.rec-edit');
      if (!btn) return;
      const id = e.target.closest('.record').dataset.id;
      const rec = Store.getRecord(id);
      if (!rec) return;
      if (btn.dataset.act === 'edit') openEditor(rec, null);
      else openEditor({
        date: Core.todayISO(), items: rec.items, itemCounts: rec.itemCounts, subItems: rec.subItems,
        minutes: rec.minutes, intensity: rec.intensity,
        content: rec.content, insight: rec.insight, effect: rec.effect,
        condition: rec.condition, tags: rec.tags
      }, Core.todayISO());
    });

    // 日暦
    $('calPrev').addEventListener('click', function () { shiftMonth(-1); });
    $('calNext').addEventListener('click', function () { shiftMonth(1); });
    $('calToday').addEventListener('click', function () {
      const d = Core.parseISO(Core.todayISO());
      ui.calYear = d.getFullYear(); ui.calMonth = d.getMonth() + 1;
      ui.calSelected = Core.todayISO();
      renderCalendar();
    });
    $('calGrid').addEventListener('click', function (e) {
      const cell = e.target.closest('.cal-cell');
      if (!cell) return;
      ui.calSelected = cell.dataset.date;
      const d = Core.parseISO(ui.calSelected);
      ui.calYear = d.getFullYear(); ui.calMonth = d.getMonth() + 1;
      renderCalendar();
    });
    $('calDayPanel').addEventListener('click', function (e) {
      const newBtn = e.target.closest('[data-new-on]');
      if (newBtn) { openEditor(null, newBtn.dataset.newOn); return; }
      const btn = e.target.closest('.rec-edit');
      if (!btn) return;
      const rec = Store.getRecord(e.target.closest('.record').dataset.id);
      if (rec) openEditor(rec, null);
    });

    // 設定
    $('addItemForm').addEventListener('submit', function (e) {
      e.preventDefault();
      const input = $('newItemInput');
      if (!input.value.trim()) return;
      if (Store.addItem(input.value)) { toast('已添加项目：' + input.value.trim()); input.value = ''; }
      else toast('这个项目已存在');
      renderSettings();
    });
    $('itemManager').addEventListener('click', function (e) {
      const chip = e.target.closest('[data-remove]');
      if (!chip) return;
      const name = chip.dataset.remove;
      if (confirm('从项目列表中删除「' + name + '」？已有记录不会受影响。')) {
        Store.removeItem(name);
        renderSettings();
      }
    });
    $('itemManager').addEventListener('click', function (e) {
      const subChip = e.target.closest('[data-remove-sub]');
      if (subChip) {
        const parent = subChip.dataset.parent;
        const name = subChip.dataset.removeSub;
        if (confirm('删除子项目「' + parent + ' › ' + name + '」？已有记录不会受影响。')) {
          Store.removeItem(name, parent);
          renderSettings();
        }
        return;
      }
      const addBtn = e.target.closest('[data-addsub2]');
      if (addBtn) {
        const input = addBtn.closest('.add-sub').querySelector('input');
        const parent = addBtn.dataset.addsub2;
        const name = String(input.value || '').trim().slice(0, 20);
        if (!name) { input.focus(); return; }
        if (Store.addItem(name, parent)) toast('已添加子项目：' + parent + ' › ' + name);
        else toast('这个子项目已存在');
        input.value = '';
        renderSettings();
      }
    });
    $('itemManager').addEventListener('keydown', function (e) {
      const input = e.target.closest('[data-newsub2]');
      if (!input || e.key !== 'Enter') return;
      e.preventDefault();
      const addBtn = input.closest('.add-sub').querySelector('[data-addsub2]');
      if (addBtn) addBtn.click();
    });
    $('exportJsonBtn').addEventListener('click', function () {
      download('体术修炼-' + stamp() + '.json', Core.toJSON(Store.get()), 'application/json');
      toast('已导出 JSON');
    });
    $('exportMdBtn').addEventListener('click', function () {
      download('体术修炼-' + stamp() + '.md', Core.toMarkdown(Store.get().records, Store.get()), 'text/markdown');
      toast('已导出 Markdown');
    });
    $('exportCsvBtn').addEventListener('click', function () {
      download('体术修炼-' + stamp() + '.csv', Core.toCSV(Store.get().records), 'text/csv');
      toast('已导出 CSV');
    });
    $('importFile').addEventListener('change', function (e) {
      const file = e.target.files && e.target.files[0];
      if (!file) return;
      const reader = new FileReader();
      reader.onload = function () {
        try {
          const res = Store.merge(Core.parseImport(String(reader.result)));
          toast('导入完成：新增 ' + res.added + ' 条，覆盖 ' + res.updated + ' 条');
          renderActive();
        } catch (err) { toast('导入失败：' + err.message); }
      };
      reader.readAsText(file);
      e.target.value = '';
    });
    $('importTextBtn').addEventListener('click', function () {
      try {
        const res = Store.merge(Core.parseImport($('importText').value));
        $('importText').value = '';
        toast('导入完成：新增 ' + res.added + ' 条，覆盖 ' + res.updated + ' 条');
        renderActive();
      } catch (err) { toast('导入失败：' + err.message); }
    });
    $('loadSampleBtn').addEventListener('click', function () {
      if (!confirm('将示例记录合并进来（不会删除现有数据）？')) return;
      const res = Store.merge(Core.sampleState());
      toast('已载入示例：新增 ' + res.added + ' 条');
      renderActive();
    });
    $('clearAllBtn').addEventListener('click', function () {
      if (!confirm('确定清空全部 ' + Store.get().records.length + ' 条记录？此操作不可撤销。')) return;
      if (!confirm('再确认一次：真的全部删除？建议先导出 JSON 备份。')) return;
      Store.clearAll();
      toast('已清空全部记录');
      renderActive();
    });

    // 弹窗
    $('editorForm').addEventListener('submit', submitEditor);
    $('editorClose').addEventListener('click', function (e) { e.preventDefault(); closeEditor(); });
    $('cancelBtn').addEventListener('click', function (e) { e.preventDefault(); closeEditor(); });
    $('deleteBtn').addEventListener('click', function () {
      if (!ui.editingId) return;
      if (!confirm('删除这条记录？')) return;
      Store.deleteRecord(ui.editingId);
      toast('已删除');
      closeEditor();
    });
    $('fItems').addEventListener('click', function (e) {
      const del = e.target.closest('[data-del-item]');
      if (del) { deleteProject(del.dataset.delItem); return; }
      const chip = e.target.closest('[data-pick]');
      if (!chip) return;
      const name = chip.dataset.pick;
      const i = ui.formItems.indexOf(name);
      if (i >= 0) {
        ui.formItems.splice(i, 1);
        ui.formSubItems = ui.formSubItems.filter(function (s) { return s.parent !== name; });
        delete ui.formItemCounts[name];
      } else {
        ui.formItems.push(name);
      }
      renderFormItems();
    });
    $('fItems').addEventListener('input', function (e) {
      const input = e.target.closest('.item-count');
      if (!input) return;
      const name = input.dataset.itemCount;
      const count = Core.clampInt(input.value, 0, 100000, 0);
      if (count > 0) ui.formItemCounts[name] = count;
      else delete ui.formItemCounts[name];
    });
    $('fSubItems').addEventListener('input', function (e) {
      const input = e.target.closest('.sub-count');
      if (!input) return;
      const parent = input.dataset.parent;
      const name = input.dataset.subCount;
      const hit = ui.formSubItems.find(function (s) { return s.parent === parent && s.name === name; });
      if (hit) hit.count = Core.clampInt(input.value, 0, 100000, 0);
    });
    $('fSubItems').addEventListener('click', function (e) {
      const del = e.target.closest('[data-del-sub]');
      if (del) { deleteSubItem(del.dataset.parent, del.dataset.delSub); return; }
      const addBtn = e.target.closest('[data-addsub]');
      if (addBtn) {
        addSubItem(addBtn.dataset.addsub, addBtn.closest('.add-sub').querySelector('input'));
        return;
      }
      const chip = e.target.closest('[data-sub]');
      if (!chip) return;
      const parent = chip.dataset.parent;
      const name = chip.dataset.sub;
      const i = ui.formSubItems.findIndex(function (s) { return s.parent === parent && s.name === name; });
      if (i >= 0) ui.formSubItems.splice(i, 1);
      else ui.formSubItems.push({ parent: parent, name: name, count: 0 });
      renderFormSubItems();
    });
    $('fSubItems').addEventListener('keydown', function (e) {
      const input = e.target.closest('[data-newsub]');
      if (!input || e.key !== 'Enter') return;
      e.preventDefault();
      const addBtn = input.closest('.add-sub').querySelector('[data-addsub]');
      if (addBtn) addSubItem(addBtn.dataset.addsub, input);
    });
    $('fItemCustom').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      const name = $('fItemCustom').value.trim().slice(0, 20);
      if (!name) return;
      if (ui.formItems.indexOf(name) < 0) ui.formItems.push(name);
      Store.addItem(name);
      $('fItemCustom').value = '';
      renderFormItems();
    });
    $('fIntensity').addEventListener('click', function (e) {
      const btn = e.target.closest('[data-i]');
      if (!btn) return;
      const n = Number(btn.dataset.i);
      ui.formIntensity = ui.formIntensity === n ? 0 : n;
      renderIntensity();
    });
    $('fMinutes').addEventListener('keydown', function (e) { if (e.key === 'Enter') { e.preventDefault(); $('fMinutes').blur(); } });
    // 在「个数」输入框里按回车不提交表单，只收起键盘
    $('editorForm').addEventListener('keydown', function (e) {
      if (e.key !== 'Enter') return;
      const input = e.target.closest && e.target.closest('.count-input');
      if (!input) return;
      e.preventDefault();
      input.blur();
    });

    // 快捷键
    document.addEventListener('keydown', function (e) {
      const tag = (e.target.tagName || '').toLowerCase();
      const typing = tag === 'input' || tag === 'textarea' || tag === 'select' || e.target.isContentEditable;
      const dialogOpen = $('editor').open || $('pwdDialog').open;
      if (e.key === 'Escape' && $('editor').open) { closeEditor(); return; }
      if (e.key === 'Escape' && $('pwdDialog').open) { closePwdDialog(); return; }
      if (typing || dialogOpen || !$('authScreen').hidden) return;
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      if (e.key === 'n' || e.key === 'N') { e.preventDefault(); openEditor(null, null); }
      else if (e.key === '/') { e.preventDefault(); switchView('log'); $('searchInput').focus(); }
    });

    // 关闭前保存
    window.addEventListener('beforeunload', function () { Store.flush(); });
    document.addEventListener('visibilitychange', function () { if (document.hidden) Store.flush(); });
  }

  function shiftMonth(delta) {
    let y = ui.calYear, m = ui.calMonth + delta;
    if (m < 1) { m = 12; y--; }
    if (m > 12) { m = 1; y++; }
    ui.calYear = y; ui.calMonth = m;
    renderCalendar();
  }

  /* ------------------------------ 启动 ------------------------------ */

  async function boot() {
    bind();
    Store.subscribe(function () {
      applyTheme(Store.get().settings.theme);
      renderBadge();
      renderAuthScreen();
      if (ui.view === 'log') { renderLogSummary(); renderFilterChips(); renderLogList(); }
      else if (ui.view === 'calendar') renderCalendar();
      else if (ui.view === 'stats') renderStats();
      else renderSettings();
    });
    await Store.init();
    const d = Core.parseISO(Core.todayISO());
    ui.calYear = d.getFullYear();
    ui.calMonth = d.getMonth() + 1;
    const hash = String(location.hash || '').replace(/^#/, '');
    if (['log', 'calendar', 'stats', 'settings'].indexOf(hash) >= 0) switchView(hash);
    else renderActive();

    const auth = Store.getAuth();
    if (auth.required && !auth.user) {
      setAuthMode('login');
      setTimeout(function () { $('authName').focus(); }, 80);
    }
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', boot);
  else boot();
})();
