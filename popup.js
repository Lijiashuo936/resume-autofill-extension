// Popup 主逻辑

(async function () {
  const $ = id => document.getElementById(id);

  // ---------- 取当前 tab ----------
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  const url = tab?.url || '';
  const hostname = (() => { try { return new URL(url).hostname; } catch { return ''; } })();

  // ---------- 检测页面状态 ----------
  $('popup-status').innerHTML = `
    <div class="popup-status-loading">
      <div class="popup-spinner"></div>
      <span>正在检测页面…</span>
    </div>`;

  // 给页面一点时间,容错
  let pageInfo = { ok: false, matches: 0 };
  try {
    if (tab?.id) {
      pageInfo = await new Promise(resolve => {
        chrome.tabs.sendMessage(tab.id, { type: 'GET_PAGE_INFO' }, resolve);
        setTimeout(() => resolve({ ok: false, matches: 0 }), 800);
      });
    }
  } catch (_) {
    pageInfo = { ok: false, matches: 0 };
  }

  renderStatus(pageInfo, hostname, tab?.title || '');

  // ---------- 渲染操作区 ----------
  $('popup-actions').style.display = '';

  $('popup-btn-fill').addEventListener('click', async () => {
    if (!tab?.id) return;
    try {
      await chrome.tabs.sendMessage(tab.id, { type: 'OPEN_PANEL' });
      window.close();
    } catch (e) {
      alert('页面尚未加载完毕,请刷新页面后再试。');
    }
  });

  $('popup-btn-fill').disabled = !pageInfo.ok || pageInfo.matches === 0;

  $('popup-btn-edit').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  $('popup-btn-options').addEventListener('click', () => {
    chrome.runtime.openOptionsPage();
    window.close();
  });

  // ---------- 渲染历史 ----------
  const { fillHistory = [] } = await chrome.storage.local.get(['fillHistory']);
  if (fillHistory.length > 0) {
    $('popup-history').style.display = '';
    const list = $('popup-history-list');
    list.innerHTML = fillHistory.slice(0, 6).map(h => `
      <div class="popup-history-item">
        <div class="popup-history-title">${escapeHtml(h.title || h.url)}</div>
        <div class="popup-history-meta">
          <span>${formatTime(h.time)}</span>
          <span class="popup-history-stat">${h.succeeded || 0} / ${h.total || 0} 字段</span>
        </div>
      </div>`).join('');
    $('popup-clear-history').addEventListener('click', e => {
      e.preventDefault();
      chrome.storage.local.set({ fillHistory: [] });
      $('popup-history').style.display = 'none';
    });
  }

  function renderStatus(info, hostname, title) {
    if (info.ok && info.matches > 0) {
      $('popup-status').innerHTML = `
        <div class="popup-status-found">
          <div class="popup-status-page"><b>${escapeHtml(title || hostname)}</b></div>
          <div class="popup-status-meta">✓ 识别到 ${info.matches} 个匹配字段</div>
        </div>`;
    } else if (info.ok) {
      $('popup-status').innerHTML = `
        <div class="popup-status-found">
          <div class="popup-status-page"><b>${escapeHtml(title || hostname)}</b></div>
          <div class="popup-status-meta none">⚠ 暂未识别到表单字段(可手动打开悬浮按钮扫描)</div>
        </div>`;
    } else {
      $('popup-status').innerHTML = `
        <div class="popup-status-found">
          <div class="popup-status-page"><b>${escapeHtml(hostname || '当前页面')}</b></div>
          <div class="popup-status-meta none">⚠ 此页面不支持(Chrome 内置页或插件页)</div>
        </div>`;
    }
  }

  function formatTime(ts) {
    const d = new Date(ts);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `${d.getHours().toString().padStart(2,'0')}:${d.getMinutes().toString().padStart(2,'0')}`;
    return `${d.getMonth()+1}/${d.getDate()}`;
  }

  function escapeHtml(s) {
    if (!s) return '';
    return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;').replace(/'/g,'&#39;');
  }
})();
