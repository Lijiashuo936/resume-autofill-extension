// 填充器 — 真正往表单里写值,并触发前端框架(React/Vue)能监听到的事件
//
// 重点: 仅靠 el.value = ... 在 React 受控组件上是无效的,
// 必须用 nativeInputValueSetter 触发 input 事件,React 才会更新状态。

(function () {

  // ---------- 触发 React/Vue 兼容事件 ----------
  function setNativeValue(el, value) {
    const proto = Object.getPrototypeOf(el);
    const setter = Object.getOwnPropertyDescriptor(proto, 'value');
    if (setter && setter.set) {
      setter.set.call(el, value);
    } else {
      el.value = value;
    }
  }

  function fireEvents(el, eventNames) {
    eventNames.forEach(name => {
      const evt = new Event(name, { bubbles: true, cancelable: true });
      el.dispatchEvent(evt);
    });
  }

  // ---------- 单个元素填充 ----------
  // return { ok, error, value }
  function fillOne(el, value, options) {
    options = options || {};
    if (value === undefined || value === null) return { ok: false, error: 'value is empty' };
    if (typeof value === 'string' && value.trim() === '') return { ok: false, error: 'value is empty' };

    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    // 只读 / 禁用 → 不填
    if (el.disabled || el.readOnly) return { ok: false, error: 'element is disabled/readonly' };

    // 1. contenteditable 富文本
    if (el.getAttribute && el.getAttribute('contenteditable') === 'true') {
      try {
        el.focus();
        el.innerText = String(value);
        fireEvents(el, ['input', 'change', 'blur']);
        return { ok: true, value: String(value) };
      } catch (e) {
        return { ok: false, error: e.message };
      }
    }

    // 2. select
    if (tag === 'select') {
      const strVal = String(value).trim();
      const matched = matchSelectOption(el, strVal);
      if (matched) {
        el.value = matched.value;
        fireEvents(el, ['change', 'input']);
        return { ok: true, value: matched.text };
      }
      return { ok: false, error: 'no matching option: ' + strVal };
    }

    // 3. radio
    if (type === 'radio') {
      const nameMatch = el.name && el.name === options.radioGroup;
      const valMatch = (el.value || '').toLowerCase() === String(value).toLowerCase();
      const labelMatch = (el.closest && el.closest('label') && el.closest('label').textContent || '').includes(String(value));
      if (valMatch || labelMatch) {
        el.checked = true;
        fireEvents(el, ['change', 'input', 'click']);
        return { ok: true, value: el.value };
      }
      return { ok: false, error: 'no radio match' };
    }

    // 4. checkbox(暂时不做"自动勾选"语义化判断;需要用户确认)
    if (type === 'checkbox') {
      const should = ['1', 'true', 'yes', 'on', '是', '有', 'agree'].includes(String(value).toLowerCase());
      if (el.checked !== should) {
        el.checked = should;
        fireEvents(el, ['change', 'input', 'click']);
      }
      return { ok: true, value: should };
    }

    // 5. date
    if (type === 'date') {
      const d = normalizeDate(String(value));
      if (!d) return { ok: false, error: 'invalid date: ' + value };
      setNativeValue(el, d);
      fireEvents(el, ['input', 'change', 'blur']);
      return { ok: true, value: d };
    }

    // 6. 普通文本(input text/email/tel/number/search/url/password)
    setNativeValue(el, String(value));
    fireEvents(el, ['input', 'change', 'blur']);
    return { ok: true, value: String(value) };
  }

  // ---------- 选 select option,模糊匹配 ----------
  function matchSelectOption(selectEl, target) {
    const t = target.toLowerCase().replace(/\s+/g, '');
    const opts = Array.from(selectEl.options || []);
    let best = null;
    let bestScore = 0;
    opts.forEach(opt => {
      if (!opt) return;
      const label = String(opt.text || '').trim();
      const value = String(opt.value || '').trim();
      if (!label && !value) return;

      const labelLow = label.toLowerCase().replace(/\s+/g, '');
      const valueLow = value.toLowerCase().replace(/\s+/g, '');

      let score = 0;
      if (label === target) score = 100;
      else if (value === target) score = 95;
      else if (labelLow === t) score = 90;
      else if (valueLow === t) score = 85;
      else if (label.includes(target)) score = 70;
      else if (labelLow.includes(t)) score = 60;
      else if (valueLow.includes(t)) score = 50;

      if (score > bestScore) { bestScore = score; best = opt; }
    });
    return bestScore >= 50 ? best : null;
  }

  // ---------- 日期归一化 ----------
  function normalizeDate(value) {
    if (!value) return '';
    const s = String(value).trim();
    // 已是 YYYY-MM-DD
    let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    // YYYY-MM
    m = s.match(/^(\d{4})[-\/年.](\d{1,2})/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-01`;
    }
    // YYYY年MM月DD日
    m = s.match(/^(\d{4})年(\d{1,2})月(\d{1,2})日/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-${String(m[3]).padStart(2,'0')}`;
    }
    // YYYY年MM月
    m = s.match(/^(\d{4})年(\d{1,2})月/);
    if (m) {
      return `${m[1]}-${String(m[2]).padStart(2,'0')}-01`;
    }
    // 仅 YYYY
    m = s.match(/^(\d{4})$/);
    if (m) {
      return `${m[1]}-01-01`;
    }
    // 其它,直接尝试 new Date
    const d = new Date(s);
    if (!isNaN(d.getTime())) {
      const yyyy = d.getFullYear();
      const mm = String(d.getMonth() + 1).padStart(2,'0');
      const dd = String(d.getDate()).padStart(2,'0');
      return `${yyyy}-${mm}-${dd}`;
    }
    return '';
  }

  // ---------- 批量填充 ----------
  // matches: [ { element, path } ]   (来自 matcher.scanForm)
  // getValue: (path) => value 的回调
  // options.fillExisting: 已填过的要不要重写
  // return { total, succeeded, failed, items }
  async function fillBatch(matches, getValue, options) {
    options = options || {};
    const items = [];
    let succeeded = 0;
    let failed = 0;

    for (const match of matches) {
      const el = match.element;
      if (!el) continue;

      // 已填过?
      if (!options.fillExisting && (el.value || (el.tagName === 'SELECT' && el.selectedIndex > 0))) {
        items.push({ ...match, status: 'skipped', reason: 'already filled' });
        continue;
      }

      const value = getValue(match.path);
      if (value === undefined || value === null || value === '') {
        items.push({ ...match, status: 'skipped', reason: 'no value' });
        continue;
      }

      const r = fillOne(el, value);
      items.push({ ...match, status: r.ok ? 'filled' : 'failed', error: r.error, value: r.value });
      if (r.ok) succeeded++; else failed++;

      // 短暂延迟,避免快速连续触发被前端 debounce 吃掉
      await new Promise(r => setTimeout(r, 30));
    }

    return { total: matches.length, succeeded, failed, items };
  }

  const Filler = { fillOne, fillBatch, normalizeDate, matchSelectOption };

  if (typeof window !== 'undefined') {
    window.Filler = Filler;
  }
  if (typeof self !== 'undefined') {
    self.Filler = Filler;
  }
})();
