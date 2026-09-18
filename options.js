// Options Page — 简历编辑器

(function () {
  const SCHEMA = window.ResumeSchema;
  const $ = id => document.getElementById(id);

  // ---------- state ----------
  let resume = {};      // 当前编辑器中的
  let original = {};    // 上次保存的,用于"放弃修改"

  // ---------- 加载 ----------
  chrome.storage.local.get(['resume'], async r => {
    resume = r.resume || {};
    original = JSON.parse(JSON.stringify(resume));
    ensureShape();
    renderNav();
    setActiveSection(Object.keys(SCHEMA)[0]);
  });

  function ensureShape() {
    Object.entries(SCHEMA).forEach(([key, group]) => {
      if (group.fields) {
        if (!resume[key] || typeof resume[key] !== 'object') resume[key] = {};
        Object.keys(group.fields).forEach(fk => {
          if (resume[key][fk] === undefined) resume[key][fk] = '';
        });
      } else if (group.type === 'list') {
        if (!Array.isArray(resume[key])) resume[key] = [];
      }
    });
  }

  // ---------- 渲染导航 ----------
  function renderNav() {
    const nav = $('nav');
    const groups = Object.entries(SCHEMA);
    nav.innerHTML = `
      ${groups.map(([key, g]) => `
        <div class="nav-item" data-section="${key}">
          <span class="nav-item-icon">${g.icon || '📄'}</span>
          <span>${g.label}</span>
        </div>`).join('')}
      <div class="nav-divider">其它</div>
      <div class="nav-item" data-section="settings">
        <span class="nav-item-icon">⚙️</span>
        <span>设置</span>
      </div>
    `;
    nav.addEventListener('click', e => {
      const item = e.target.closest('.nav-item');
      if (!item) return;
      setActiveSection(item.dataset.section);
    });
  }

  function setActiveSection(key) {
    $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === key));
    if (key === 'settings') {
      renderSettings();
    } else {
      renderGroup(key);
    }
  }

  function $$(sel) { return Array.from(document.querySelectorAll(sel)); }

  // ---------- 渲染单个分组 ----------
  function renderGroup(key) {
    const group = SCHEMA[key];
    $('page-title').textContent = group.label;

    if (group.fields) {
      $('page-sub').textContent = '基础信息,用于自动填充表单';
      $('content').innerHTML = renderFieldsForm(key, group.fields);
    } else if (group.type === 'list') {
      $('page-sub').textContent = '添加一条或多条,按时间倒序(最新在最上)';
      $('content').innerHTML = renderListForm(key, group);
    }
  }

  function renderFieldsForm(groupKey, fields) {
    return `
      <div class="form">
        <div class="form-row">
          ${Object.entries(fields).map(([fk, f]) => renderField(groupKey, fk, f)).join('')}
        </div>
      </div>`;
  }

  function renderField(groupKey, fk, f) {
    const val = resume[groupKey][fk] || '';
    const key = `f:${groupKey}.${fk}`;
    if (f.type === 'textarea') {
      return `
        <div class="form-group full">
          <label class="form-label">${f.label}</label>
          <textarea class="form-textarea" data-key="${key}" placeholder="例: ${f.synonyms[0]}">${escapeHtml(val)}</textarea>
        </div>`;
    }
    if (f.type === 'enum' && f.options) {
      return `
        <div class="form-group">
          <label class="form-label">${f.label}</label>
          <select class="form-select" data-key="${key}">
            <option value="">（未填）</option>
            ${f.options.map(o => `<option value="${escapeHtml(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
          </select>
          <div class="form-hint">候选项: ${f.options.slice(0, 5).join('、')}${f.options.length > 5 ? '…' : ''}</div>
        </div>`;
    }
    const inputType = (f.type === 'date' || f.type === 'phone' || f.type === 'email' || f.type === 'number') ? f.type : 'text';
    return `
      <div class="form-group">
        <label class="form-label">${f.label}</label>
        <input class="form-input" type="${inputType}" data-key="${key}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.synonyms[0] || '')}">
      </div>`;
  }

  function renderListForm(groupKey, group) {
    const list = resume[groupKey] || [];
    return `
      <div class="form">
        ${list.length === 0 ? `<div class="list-empty">还没有数据。点击下方按钮添加。</div>` : ''}
        ${list.map((item, idx) => renderListCard(groupKey, group, idx)).join('')}
        <button class="btn-add" id="btn-add-${groupKey}">+ 添加${group.label.replace(/[^\u4e00-\u9fa5]/g, '').slice(0, 4)}</button>
      </div>`;
  }

  function renderListCard(groupKey, group, idx) {
    const item = resume[groupKey][idx] || {};
    const fk = group.itemFields;
    const preview = item[Object.keys(fk).find(k => item[k]) || 'name'] || item[Object.keys(fk)[0]] || `#${idx + 1}`;
    return `
      <div class="list-card" data-card-idx="${idx}">
        <div class="list-card-header">
          <span class="list-card-title">${escapeHtml(String(preview).slice(0, 30)) || '#' + (idx + 1)}</span>
          <div class="list-card-actions">
            <button class="up" data-action="up">↑ 上移</button>
            <button class="down" data-action="down">↓ 下移</button>
            <button class="del" data-action="del">删除</button>
          </div>
        </div>
        <div class="form-row">
          ${Object.entries(fk).map(([k, f]) => {
            const val = item[k] || '';
            const key = `l:${groupKey}.${idx}.${k}`;
            if (f.type === 'textarea') {
              return `<div class="form-group full">
                <label class="form-label">${f.label}</label>
                <textarea class="form-textarea" data-key="${key}" placeholder="例: ${f.synonyms[0]}">${escapeHtml(val)}</textarea>
              </div>`;
            }
            if (f.type === 'enum' && f.options) {
              return `<div class="form-group">
                <label class="form-label">${f.label}</label>
                <select class="form-select" data-key="${key}">
                  <option value="">（未填）</option>
                  ${f.options.map(o => `<option value="${escapeHtml(o)}" ${val === o ? 'selected' : ''}>${escapeHtml(o)}</option>`).join('')}
                </select>
              </div>`;
            }
            return `<div class="form-group">
              <label class="form-label">${f.label}</label>
              <input class="form-input" type="text" data-key="${key}" value="${escapeHtml(val)}" placeholder="${escapeHtml(f.synonyms[0] || '')}">
            </div>`;
          }).join('')}
        </div>
      </div>`;
  }

  // ---------- 绑定 input 变更 ----------
  document.addEventListener('input', e => {
    const t = e.target;
    const k = t.dataset.key;
    if (!k) return;
    setResumeByKey(k, t.value);
  });

  document.addEventListener('change', e => {
    const t = e.target;
    const k = t.dataset.key;
    if (!k) return;
    setResumeByKey(k, t.value);
  });

  function setResumeByKey(k, v) {
    if (k.startsWith('f:')) {
      const path = k.slice(2).split('.');
      const fk = path.pop();
      let cur = resume;
      path.forEach(p => cur = cur[p]);
      cur[fk] = v;
    } else if (k.startsWith('l:')) {
      const [groupKey, idx, ...rest] = k.slice(2).split('.');
      const fk = rest.join('.');
      if (!resume[groupKey][parseInt(idx, 10)]) resume[groupKey][parseInt(idx, 10)] = {};
      resume[groupKey][parseInt(idx, 10)][fk] = v;
    }
  }

  // ---------- 添加/删除/排序 list ----------
  document.addEventListener('click', e => {
    const addBtn = e.target.closest('[id^="btn-add-"]');
    if (addBtn) {
      const key = addBtn.id.replace('btn-add-', '');
      const empty = {};
      Object.keys(SCHEMA[key].itemFields).forEach(k => empty[k] = '');
      resume[key].unshift(empty);
      // 重渲染当前分组
      renderGroup(key);
      // 设置激活项高亮保持
      $$('.nav-item').forEach(el => el.classList.toggle('active', el.dataset.section === key));
      $('page-title').textContent = SCHEMA[key].label;
      return;
    }

    const cardBtn = e.target.closest('.list-card [data-action]');
    if (cardBtn) {
      const card = cardBtn.closest('.list-card');
      const idx = parseInt(card.dataset.cardIdx, 10);
      const cardKey = findCurrentListKey();
      if (!cardKey) return;
      const action = cardBtn.dataset.action;
      if (action === 'del') {
        if (!confirm('确定要删除这一条吗?')) return;
        resume[cardKey].splice(idx, 1);
      } else if (action === 'up' && idx > 0) {
        const arr = resume[cardKey];
        [arr[idx - 1], arr[idx]] = [arr[idx], arr[idx - 1]];
      } else if (action === 'down' && idx < resume[cardKey].length - 1) {
        const arr = resume[cardKey];
        [arr[idx + 1], arr[idx]] = [arr[idx], arr[idx + 1]];
      }
      renderGroup(cardKey);
    }
  });

  function findCurrentListKey() {
    const active = $$('.nav-item.active')[0];
    return active ? active.dataset.section : null;
  }

  // ---------- 保存 ----------
  $('btn-save').addEventListener('click', () => {
    save();
  });

  async function save() {
    const status = $('save-status');
    try {
      await new Promise(r => chrome.runtime.sendMessage({ type: 'SET_RESUME', resume }, r));
      original = JSON.parse(JSON.stringify(resume));
      status.textContent = '✓ 已保存 ' + new Date().toLocaleTimeString();
      status.classList.remove('error');
      setTimeout(() => { status.textContent = ''; }, 3000);
    } catch (e) {
      status.textContent = '✕ 保存失败: ' + e.message;
      status.classList.add('error');
    }
  }

  $('btn-reset').addEventListener('click', () => {
    if (!confirm('放弃当前所有未保存的修改吗?')) return;
    resume = JSON.parse(JSON.stringify(original));
    renderGroup(findCurrentListKey() || Object.keys(SCHEMA)[0]);
    $('save-status').textContent = '已重置';
    setTimeout(() => { $('save-status').textContent = ''; }, 2000);
  });

  // ---------- 导入 / 导出 ----------
  $('btn-export').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(resume, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = 'resume-' + new Date().toISOString().slice(0, 10) + '.json';
    a.click();
    URL.revokeObjectURL(url);
  });

  $('btn-import').addEventListener('click', () => $('file-import').click());
  $('file-import').addEventListener('change', e => {
    const file = e.target.files[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async ev => {
      try {
        const obj = JSON.parse(ev.target.result);
        if (typeof obj !== 'object') throw new Error('格式不对');
        resume = obj;
        ensureShape();
        renderGroup(findCurrentListKey() || Object.keys(SCHEMA)[0]);
        await save(); // 导入后自动保存,不再依赖手动点击
        alert('导入并保存成功!');
      } catch (err) {
        alert('导入失败: ' + err.message);
      }
    };
    reader.readAsText(file);
    e.target.value = '';
  });

  $('btn-clear').addEventListener('click', () => {
    if (!confirm('这将清空你的简历数据。建议先导出备份!\n确定清空吗?')) return;
    Object.entries(SCHEMA).forEach(([k, g]) => {
      if (g.fields) {
        resume[k] = Object.fromEntries(Object.keys(g.fields).map(fk => [fk, '']));
      } else if (g.type === 'list') {
        resume[k] = [];
      }
    });
    ensureShape();
    renderGroup(findCurrentListKey() || Object.keys(SCHEMA)[0]);
  });

  // ---------- Settings ----------
  async function renderSettings() {
    $('page-title').textContent = '设置';
    $('page-sub').textContent = 'AI 增强、导入导出等';
    const { deepseekKey = '', useAI = false } = await chrome.storage.local.get(['deepseekKey', 'useAI']);

    $('content').innerHTML = `
      <div class="settings-section">
        <h2>🤖 AI 增强(可选)</h2>
        <p class="settings-desc">
          默认使用本地规则匹配,覆盖 80% 常见表单。
          启用 AI 后,可对未匹配的字段智能推断(用 DeepSeek Chat 模型)。
        </p>
        <div class="settings-row">
          <label>启用 AI 匹配</label>
          <div class="toggle-switch ${useAI ? 'on' : ''}" id="toggle-use-ai"></div>
        </div>
        <div class="settings-row">
          <label>DeepSeek API Key</label>
          <input class="form-input" type="password" id="input-ai-key" value="${escapeHtml(deepseekKey)}" placeholder="sk-...">
        </div>
        <p class="settings-desc">
          没有 Key? 前往 <a href="https://platform.deepseek.com/" target="_blank">platform.deepseek.com</a> 注册,生成 API Key。
          Key 只存在浏览器本地,仅在你点"AI 匹配"时才调用。
        </p>
      </div>

      <div class="settings-section">
        <h2>📦 数据管理</h2>
        <p class="settings-desc">所有简历数据存在 <code>chrome.storage.local</code>,仅本机可用。</p>
        <div style="display:flex; gap:8px; margin-top: 10px;">
          <button class="btn btn-secondary" id="btn-export-settings">📤 导出 JSON</button>
          <button class="btn btn-secondary" id="btn-import-settings">📥 导入 JSON</button>
        </div>
      </div>

      <div class="settings-section">
        <h2>ℹ️ 关于</h2>
        <p class="settings-desc">简历飞填 v1.0.0 — 完全本地、纯前端、零上传、零追踪。</p>
      </div>
    `;

    $('toggle-use-ai').addEventListener('click', async () => {
      const el = $('toggle-use-ai');
      const on = !el.classList.contains('on');
      el.classList.toggle('on', on);
      await chrome.runtime.sendMessage({ type: 'SET_DEEPSEEK_KEY', key: $('input-ai-key').value, useAI: on });
    });
    $('input-ai-key').addEventListener('change', async () => {
      const on = $('toggle-use-ai').classList.contains('on');
      await chrome.runtime.sendMessage({ type: 'SET_DEEPSEEK_KEY', key: $('input-ai-key').value, useAI: on });
    });
    $('btn-export-settings').addEventListener('click', () => $('btn-export').click());
    $('btn-import-settings').addEventListener('click', () => $('btn-import').click());
  }

  // ---------- utility ----------
  function escapeHtml(s) {
    if (s === undefined || s === null) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }

  // ---------- beforeunload 提醒 ----------
  window.addEventListener('beforeunload', e => {
    if (JSON.stringify(resume) !== JSON.stringify(original)) {
      e.preventDefault();
      e.returnValue = '有未保存的修改,确定离开吗?';
    }
  });
})();
