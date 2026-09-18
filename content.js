// Content Script v1.1
//   右下角悬浮按钮 → 点击扫描表单 → 预览面板 → 确认填充
//   v1.1 重要改进:
//     1. 重新加载扩展后可自动接管(移除旧 DOM,不再盲目 return)
//     2. 全流程分步诊断日志,卡住时面板直接显示卡在哪一步
//     3. 所有异步操作带超时保护,不会再无限转圈
//     4. 直接读 chrome.storage.local,不依赖 background 消息

(function () {
  const TAG = '[简历飞填]';
  const VERSION = '1.1.0';

  // ---------- 接管旧实例 ----------
  // 扩展重新加载后 content script 会被重新注入。旧 DOM 还在,
  // 这里主动清理并重建,避免"新代码不生效"。
  try {
    const oldFab = document.getElementById('feitian-fab');
    if (oldFab) oldFab.remove();
    const oldPanel = document.getElementById('feitian-panel');
    if (oldPanel) oldPanel.remove();
  } catch (e) { /* ignore */ }

  // ---------- 运行时自检 ----------
  const diag = {
    version: VERSION,
    schema: !!(typeof window !== 'undefined' && window.ResumeSchema),
    matcher: !!(typeof window !== 'undefined' && window.Matcher),
    filler: !!(typeof window !== 'undefined' && window.Filler),
    storage: !!(typeof chrome !== 'undefined' && chrome.storage && chrome.storage.local)
  };
  console.log(TAG, 'v' + VERSION, '自检:', diag);

  if (!diag.schema || !diag.matcher || !diag.filler) {
    console.error(TAG, '核心脚本未加载!请检查 manifest.json 的 content_scripts.js 顺序,并刷新页面。');
  }

  function log(...args) {
    console.log(TAG, ...args);
  }

  // 给 Promise 加超时,避免永远挂起
  function withTimeout(promise, ms, label) {
    return Promise.race([
      promise,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error((label || '操作') + ' 超时(' + ms + 'ms)')), ms)
      )
    ]);
  }

  // ---------- 浮动按钮 ----------
  const fab = document.createElement('div');
  fab.id = 'feitian-fab';
  fab.innerHTML = `
    <div class="feitian-fab-inner">
      <span class="feitian-fab-icon">🚀</span>
      <span class="feitian-fab-text">一键填简历</span>
    </div>`;

  // ---------- 主面板 ----------
  const panel = document.createElement('div');
  panel.id = 'feitian-panel';
  panel.style.display = 'none';
  panel.innerHTML = `
    <div class="feitian-header">
      <div class="feitian-header-title">🚀 简历飞填</div>
      <div class="feitian-header-actions">
        <button class="feitian-icon-btn" data-action="close" title="关闭">✕</button>
      </div>
    </div>
    <div class="feitian-body">
      <div class="feitian-step feitian-step-scan" style="display:none">
        <div class="feitian-step-title">正在扫描表单…</div>
        <div class="feitian-spinner"></div>
        <div class="feitian-diag" id="feitian-diag"></div>
      </div>
      <div class="feitian-step feitian-step-result" style="display:none">
        <div class="feitian-summary"></div>
        <div class="feitian-controls">
          <label><input type="checkbox" id="feitian-chk-existing"> 覆盖已填写字段</label>
        </div>
        <div class="feitian-list"></div>
        <div class="feitian-actions">
          <button class="feitian-btn feitian-btn-secondary" data-action="rescan">重新扫描</button>
          <button class="feitian-btn feitian-btn-primary" data-action="fill">确认填写</button>
        </div>
      </div>
      <div class="feitian-step feitian-step-done" style="display:none">
        <div class="feitian-done-summary"></div>
        <div class="feitian-actions">
          <button class="feitian-btn feitian-btn-secondary" data-action="edit-resume">编辑简历</button>
          <button class="feitian-btn feitian-btn-primary" data-action="rescan">再扫一次</button>
        </div>
      </div>
      <div class="feitian-step feitian-step-error" style="display:none">
        <div class="feitian-error-box"></div>
        <div class="feitian-actions">
          <button class="feitian-btn feitian-btn-secondary" data-action="diag">查看诊断</button>
          <button class="feitian-btn feitian-btn-primary" data-action="rescan">重试</button>
        </div>
      </div>
    </div>`;

  // 等 body 可用再挂载(极少数页面 document_idle 时 body 仍为空)
  function mount() {
    if (document.body) {
      document.body.appendChild(fab);
      document.body.appendChild(panel);
    } else {
      setTimeout(mount, 200);
    }
  }
  mount();

  // ---------- 工具函数 ----------
  function $(sel, root) { return (root || panel).querySelector(sel); }
  function $$(sel, root) { return Array.from((root || panel).querySelectorAll(sel)); }

  function renderDiag(text) {
    const el = document.getElementById('feitian-diag');
    if (el) el.textContent = text;
  }

  // 把 "personal.name" / "education.*.school" 从 resume 里取值
  //   关键: 支持 "*" 通配数组(教育/实习/项目/技能等列表字段)
  function getResumeValue(resume, path) {
    if (!resume || !path) return '';
    return resolvePath(resume, path.split('.'));
  }

  function resolvePath(cur, parts) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (cur === null || cur === undefined) return '';

      // 数组通配: 依次尝试每个元素,取第一个有值的
      if (p === '*') {
        const rest = parts.slice(i + 1);
        if (Array.isArray(cur)) {
          for (const item of cur) {
            const v = resolvePath(item, rest);
            if (v !== '') return v;
          }
          return '';
        }
        continue; // 不是数组,跳过通配符继续往下走
      }

      cur = cur[p];
    }

    if (cur === null || cur === undefined) return '';
    if (Array.isArray(cur)) {
      if (cur.length === 0) return '';
      const first = cur[0];
      if (first && typeof first === 'object') {
        return Object.values(first).filter(Boolean).join(' / ');
      }
      return cur.filter(Boolean).join('、');
    }
    if (typeof cur === 'object') {
      return Object.values(cur).filter(Boolean).join(' / ');
    }
    return String(cur);
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s)
      .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
  }

  // ---------- 步骤切换 ----------
  function showStep(name) {
    const steps = $$('.feitian-step');
    steps.forEach(el => el.style.display = 'none');
    const map = {
      scan: '.feitian-step-scan',
      result: '.feitian-step-result',
      done: '.feitian-step-done',
      error: '.feitian-step-error'
    };
    const el = panel.querySelector(map[name]);
    if (el) el.style.display = '';
  }

  function showError(msg, detail) {
    $('.feitian-error-box').innerHTML = `
      <div class="feitian-result-banner feitian-result-none">${escapeHtml(msg)}</div>
      ${detail ? `<pre class="feitian-diag-pre">${escapeHtml(detail)}</pre>` : ''}
    `;
    showStep('error');
  }

  // ---------- 事件绑定 ----------
  fab.addEventListener('click', e => {
    e.stopPropagation();
    const willShow = panel.style.display === 'none';
    panel.style.display = willShow ? 'flex' : 'none';
    if (willShow) runScan();
  });

  panel.addEventListener('click', e => {
    const btn = e.target.closest('[data-action]');
    if (!btn) return;
    const action = btn.dataset.action;
    if (action === 'close') {
      panel.style.display = 'none';
    } else if (action === 'rescan') {
      runScan();
    } else if (action === 'fill') {
      doFill();
    } else if (action === 'edit-resume') {
      try { chrome.runtime.openOptionsPage(); } catch (err) { showError('无法打开选项页', err.message); }
    } else if (action === 'diag') {
      runDiag();
    }
  });

  // ---------- 扫描主流程 ----------
  let currentMatches = [];

  async function runScan() {
    showStep('scan');
    renderDiag('步骤 1/4:检查脚本…');

    try {
      // --- 0. 孤儿脚本检测 ---
      // 扩展刷新后,已打开页面里的旧 content script 与后台断开,
      // 任何 chrome API 调用都会挂起或报 "Extension context invalidated"。
      // 这里先 ping 一下 storage,失败立刻给出明确指引,不再无限转圈。
      if (diag.storage) {
        try {
          await withTimeout(chrome.storage.local.get(null), 2000, '扩展连接检测');
        } catch (e) {
          throw new Error('扩展刚更新过,本页面还在运行旧脚本。请按 F5 刷新本页面,再点悬浮按钮。');
        }
      }

      // --- 1. 自检 ---
      if (!diag.schema || !diag.matcher || !diag.filler) {
        throw new Error('核心脚本未加载(ResumeSchema/Matcher/Filler 缺失)。请刷新页面。');
      }

      // 让浏览器渲染一帧,避免长任务阻塞 UI
      await new Promise(r => setTimeout(r, 60));

      // --- 2. 读简历 ---
      renderDiag('步骤 2/4:读取本地简历…');
      let resume = {};
      if (diag.storage) {
        try {
          const st = await withTimeout(chrome.storage.local.get(['resume']), 3000, '读取简历');
          resume = (st && st.resume) ? st.resume : {};
        } catch (e) {
          log('读取简历失败,继续用空简历:', e.message);
          resume = {};
        }
      }
      const resumeFieldCount = countFilled(resume);
      log('简历已读取,非空字段数:', resumeFieldCount);

      // --- 3. 扫描 DOM ---
      renderDiag('步骤 3/4:扫描页面表单…(简历字段 ' + resumeFieldCount + ' 个)');
      await new Promise(r => setTimeout(r, 60));

      const t0 = performance.now();
      const rawMatches = window.Matcher.scanForm(window.ResumeSchema);
      const cost = Math.round(performance.now() - t0);
      const inputCount = document.querySelectorAll('input, select, textarea').length;
      log('扫描完成:', rawMatches.length, '个匹配,耗时', cost, 'ms; 页面表单元素', inputCount, '个');

      // --- 4. 关联值 ---
      renderDiag('步骤 4/4:匹配简历数据…');
      currentMatches = rawMatches.map(m => ({
        ...m,
        value: getResumeValue(resume, m.path)
      }));

      renderResult(inputCount, cost, resumeFieldCount);
    } catch (err) {
      console.error(TAG, '扫描失败:', err);
      const d = [
        '版本: v' + VERSION,
        'ResumeSchema: ' + diag.schema,
        'Matcher: ' + diag.matcher,
        'Filler: ' + diag.filler,
        'storage: ' + diag.storage,
        '页面: ' + location.hostname,
        '错误: ' + (err && err.message ? err.message : String(err))
      ].join('\n');
      showError('扫描出错', d);
    }
  }

  function countFilled(resume) {
    let n = 0;
    const walk = (obj) => {
      if (obj === null || obj === undefined) return;
      if (typeof obj === 'string') { if (obj.trim()) n++; return; }
      if (typeof obj === 'number') { n++; return; }
      if (Array.isArray(obj)) { obj.forEach(walk); return; }
      if (typeof obj === 'object') { Object.values(obj).forEach(walk); }
    };
    walk(resume);
    return n;
  }

  async function runDiag() {
    const info = [
      '版本: v' + VERSION,
      'ResumeSchema 已加载: ' + diag.schema,
      'Matcher 已加载: ' + diag.matcher,
      'Filler 已加载: ' + diag.filler,
      'chrome.storage 可用: ' + diag.storage,
      '',
      '当前页面: ' + location.href,
      '表单元素总数: ' + document.querySelectorAll('input, select, textarea').length,
      'iframe 数量: ' + document.querySelectorAll('iframe').length,
      '',
      'Schema 字段分组: ' + (diag.schema ? Object.keys(window.ResumeSchema).join(', ') : 'N/A')
    ].join('\n');
    $('.feitian-error-box').innerHTML = `<pre class="feitian-diag-pre">${escapeHtml(info)}</pre>`;
    showStep('error');
    console.log(TAG, info);
  }

  function renderResult(inputCount, cost, resumeFieldCount) {
    const total = currentMatches.length;
    const withValue = currentMatches.filter(m => m.value).length;
    const withoutValue = total - withValue;

    $('.feitian-summary', panel).innerHTML = `
      <div class="feitian-stats">
        <div class="feitian-stat"><div class="feitian-stat-num">${total}</div><div class="feitian-stat-label">识别字段</div></div>
        <div class="feitian-stat"><div class="feitian-stat-num" style="color:#10b981">${withValue}</div><div class="feitian-stat-label">可填写</div></div>
        <div class="feitian-stat"><div class="feitian-stat-num" style="color:#f59e0b">${withoutValue}</div><div class="feitian-stat-label">无值</div></div>
      </div>
      <div class="feitian-scan-meta">页面 ${inputCount} 个表单元素 · 匹配耗时 ${cost}ms · 简历 ${resumeFieldCount} 项</div>
    `;

    const list = $('.feitian-list', panel);

    if (total === 0) {
      let hint = '';
      if (resumeFieldCount === 0) {
        hint = '你的简历还是空的 —— 请先去 <b>选项页</b> 填写或导入简历数据。';
      } else if (inputCount === 0) {
        hint = '当前页面没有检测到任何表单元素。可能表单在 iframe 里,或还没加载出来。';
      } else {
        hint = `页面上有 ${inputCount} 个表单元素,但字段名没匹配上。可能是这个网站用了非常规字段命名。`;
      }
      list.innerHTML = `
        <div class="feitian-empty">
          <p style="margin-bottom:10px">${hint}</p>
          <a href="#" id="feitian-edit-link">→ 打开简历编辑页</a>
        </div>`;
      const link = list.querySelector('#feitian-edit-link');
      if (link) link.addEventListener('click', ev => {
        ev.preventDefault();
        chrome.runtime.openOptionsPage();
      });
      showStep('result');
      return;
    }

    list.innerHTML = currentMatches.map((m, i) => {
      const confLabel = m.confidence === 'high' ? '高' : '中';
      const confColor = m.confidence === 'high' ? '#10b981' : '#f59e0b';
      const valDisplay = m.value
        ? escapeHtml(String(m.value).slice(0, 120))
        : '<span style="color:#9ca3af">— 简历中无此数据 —</span>';
      const checked = m.value ? 'checked' : '';
      const disabled = m.value ? '' : 'disabled';
      return `
        <label class="feitian-item ${m.value ? '' : 'feitian-empty-item'}">
          <input type="checkbox" data-index="${i}" ${checked} ${disabled}>
          <div class="feitian-item-body">
            <div class="feitian-item-title">
              <span class="feitian-item-path">${escapeHtml(m.path)}</span>
              <span class="feitian-item-synonym">命中「${escapeHtml(m.matchedSynonym)}」</span>
              <span class="feitian-item-conf" style="color:${confColor}">${confLabel}</span>
            </div>
            <div class="feitian-item-value">${valDisplay}</div>
          </div>
        </label>`;
    }).join('');

    showStep('result');
  }

  // ---------- 填充 ----------
  async function doFill() {
    const fillExisting = $('#feitian-chk-existing').checked;
    const selected = $$('.feitian-list input[type=checkbox]:checked')
      .map(cb => parseInt(cb.dataset.index, 10));
    const items = currentMatches.filter((_, i) => selected.includes(i));

    if (items.length === 0) {
      alert('请至少勾选一个要填写的字段');
      return;
    }

    let succeeded = 0, failed = 0;
    const results = [];

    for (const m of items) {
      if (!fillExisting && !isEmptyValue(m.element)) {
        results.push({ ...m, status: 'skipped', msg: '已填写,跳过' });
        continue;
      }
      const r = window.Filler.fillOne(m.element, m.value);
      results.push({ ...m, status: r.ok ? 'filled' : 'failed', msg: r.value || r.error || '' });
      if (r.ok) succeeded++; else failed++;
      await new Promise(res => setTimeout(res, 30));
    }

    $('.feitian-done-summary').innerHTML = `
      <div class="feitian-result-banner feitian-result-${failed === 0 ? 'all' : (succeeded === 0 ? 'none' : 'partial')}">
        ${succeeded} 成功${failed ? ' / ' + failed + ' 失败' : ''} / 共 ${items.length} 个字段
      </div>
      <div class="feitian-result-list">
        ${results.map(r => `
          <div class="feitian-result-item ${r.status}">
            <span class="feitian-result-dot"></span>
            <span class="feitian-result-path">${escapeHtml(r.path)}</span>
            <span class="feitian-result-msg">${escapeHtml(String(r.msg).slice(0, 60))}</span>
          </div>`).join('')}
      </div>`;
    showStep('done');

    try {
      chrome.runtime.sendMessage({
        type: 'PUSH_HISTORY',
        url: location.href,
        title: document.title,
        succeeded, failed, total: items.length
      });
    } catch (e) { /* 忽略 */ }
  }

  function isEmptyValue(el) {
    if (!el) return true;
    const tag = el.tagName.toLowerCase();
    if (tag === 'select') return el.selectedIndex <= 0;
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      return !(el.innerText || '').trim();
    }
    return !(el.value || '').trim();
  }

  // ---------- 响应 popup ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg.type === 'OPEN_PANEL' || msg.type === 'TRIGGER_SCAN') {
      panel.style.display = 'flex';
      runScan();
      sendResponse({ ok: true });
      return true;
    }
    if (msg.type === 'GET_PAGE_INFO') {
      let count = 0;
      try {
        count = diag.matcher ? window.Matcher.scanForm(window.ResumeSchema).length : 0;
      } catch (e) { count = 0; }
      sendResponse({
        ok: true,
        url: location.href,
        title: document.title,
        matches: count,
        inputs: document.querySelectorAll('input, select, textarea').length
      });
      return true;
    }
  });

  log('v' + VERSION + ' 已注入:', location.hostname);
})();
