// 字段匹配器 v1.1
//   把网页上的 <input>/<select>/<textarea> 映射到 ResumeSchema 中的字段
//
//   匹配策略(按优先级):
//     1. 元素自身属性(id/name/placeholder/aria-label/title/data-*)
//     2. 关联 <label>(父级 label 或 label[for=id])
//     3. 前序兄弟节点的短文本(中文表单常见:*姓名* [input])
//     4. 最近的容器标题(.form-label/.label/.ant-form-item-label 等)
//
//   v1.1 性能改进:
//     - 只处理"可见 + 可输入"的元素,提前剪枝
//     - 上下文采集按需进行,前面的来源命中就停止
//     - 增加时间预算,超大页面不会卡死
//     - synonym 索引缓存,避免重复构建

(function () {

  // ---------- 文本归一化 ----------
  function norm(s) {
    if (!s) return '';
    return String(s)
      .toLowerCase()
      .replace(/[\s_\-*./\\()\[\]{}+#?!,:;"'`~@$%^&|=<>【】《》（）·、。]/g, '')
      .trim();
  }

  function safeQuery(root, sel) {
    try { return root.querySelector(sel); } catch (e) { return null; }
  }

  // ---------- label 文本 ----------
  function getLabelText(el) {
    let text = '';
    try {
      const parentLabel = el.closest && el.closest('label');
      if (parentLabel) {
        text = (parentLabel.innerText || parentLabel.textContent || '').trim();
      }
    } catch (e) { /* ignore */ }

    if (!text && el.id && typeof CSS !== 'undefined' && CSS.escape) {
      const linked = safeQuery(document, 'label[for="' + CSS.escape(el.id) + '"]');
      if (linked) text = (linked.innerText || linked.textContent || '').trim();
    }
    // label 文本里如果包含 input 自身,清理掉 value 干扰
    if (text.length > 60) text = text.slice(0, 60);
    return text;
  }

  // ---------- 上下文采集 ----------
  function collectContext(el) {
    const parts = [];

    // 1. 元素自身属性
    const attrs = ['id', 'name', 'placeholder', 'aria-label', 'title',
                   'data-field', 'data-name', 'data-key', 'data-prop'];
    for (let i = 0; i < attrs.length; i++) {
      const v = el.getAttribute && el.getAttribute(attrs[i]);
      if (v && v.length < 60) parts.push(v);
    }
    if (parts.length > 0) {
      const labelText = getLabelText(el);
      if (labelText) parts.push(labelText);
      return parts.join(' ');
    }

    // 2. label
    const labelText = getLabelText(el);
    if (labelText) parts.push(labelText);

    // 3. 前序兄弟节点
    let prev = el.previousElementSibling;
    for (let i = 0; i < 2 && prev; i++) {
      const t = (prev.innerText || prev.textContent || '').trim();
      if (t && t.length < 24) parts.push(t);
      prev = prev.previousElementSibling;
    }

    // 4. 父容器标题(仅在前面都没结果时才做,代价较高)
    if (parts.length === 0) {
      let p = el.parentElement;
      for (let i = 0; i < 2 && p; i++) {
        const titleEl = safeQuery(p, '.form-label,.field-label,.ant-form-item-label,.el-form-item__label,.label,.title');
        if (titleEl && titleEl !== el) {
          const t = (titleEl.innerText || '').trim();
          if (t && t.length < 24) { parts.push(t); break; }
        }
        p = p.parentElement;
      }
    }

    // 5. 兜底: 父节点短文本
    if (parts.length === 0 && el.parentElement) {
      const t = (el.parentElement.innerText || '').trim();
      if (t && t.length < 60) parts.push(t);
    }

    return parts.join(' ');
  }

  // ---------- synonym 索引(带缓存) ----------
  let CACHED_INDEX = null;
  let CACHED_SCHEMA = null;

  // 中文 synonym 加权重: 中文表单标签更精确
  // 例: "期望城市"(中文) 应胜过 "city"(英文),否则会被现居城市抢走
  function weightOf(syn) {
    const hasChinese = /[\u4e00-\u9fa5]/.test(syn);
    // 中文词单位信息量更大 → 每个中文字算 1.5 个权重
    let w = 0;
    for (const ch of syn) {
      w += /[\u4e00-\u9fa5]/.test(ch) ? 1.5 : 1;
    }
    return w + (hasChinese ? 0.5 : 0);
  }

  function buildSynonymIndex(schema) {
    if (CACHED_INDEX && CACHED_SCHEMA === schema) return CACHED_INDEX;

    const index = [];
    Object.keys(schema).forEach(groupKey => {
      const group = schema[groupKey];

      if (group.fields) {
        Object.keys(group.fields).forEach(fieldKey => {
          const field = group.fields[fieldKey];
          (field.synonyms || []).forEach(syn => {
            index.push({
              path: groupKey + '.' + fieldKey,
              synonym: syn,
              key: norm(syn),
              weight: weightOf(syn)
            });
          });
        });
      }

      if (group.itemFields) {
        Object.keys(group.itemFields).forEach(fieldKey => {
          const field = group.itemFields[fieldKey];
          (field.synonyms || []).forEach(syn => {
            index.push({
              path: groupKey + '.*.' + fieldKey,
              synonym: syn,
              key: norm(syn),
              weight: weightOf(syn)
            });
          });
        });
      }
    });

    // weight 降序 → 第一个命中的即为最优
    index.sort((a, b) => b.weight - a.weight);
    CACHED_INDEX = index;
    CACHED_SCHEMA = schema;
    return index;
  }

  // ---------- 单条文本匹配 ----------
  function bestMatch(text, index) {
    const t = norm(text);
    if (!t) return null;
    for (let i = 0; i < index.length; i++) {
      const item = index[i];
      if (item.key && t.indexOf(item.key) !== -1) {
        return item; // index 已按 weight 降序,首个命中即最优
      }
    }
    return null;
  }

  // ---------- 元素可用性剪枝 ----------
  function isFillable(el) {
    const tag = el.tagName.toLowerCase();
    const type = (el.type || '').toLowerCase();

    if (el.disabled) return false;

    if (type === 'hidden' || type === 'password' || type === 'file' ||
        type === 'submit' || type === 'button' || type === 'reset' || type === 'image') {
      return false;
    }

    if (el.getAttribute && el.getAttribute('aria-hidden') === 'true') return false;

    // 明显的隐藏元素跳过(select 除外,很多网站用自定义样式隐藏原生 select)
    if (el.offsetParent === null && tag !== 'select') {
      let style = null;
      try { style = window.getComputedStyle(el); } catch (e) { /* ignore */ }
      if (style && (style.display === 'none' || style.visibility === 'hidden')) return false;
    }

    return true;
  }

  // ---------- 主扫描 ----------
  function scanForm(schema) {
    if (!schema) {
      schema = (typeof window !== 'undefined' && window.ResumeSchema) ||
               (typeof self !== 'undefined' && self.ResumeSchema);
    }
    if (!schema) {
      console.warn('[简历飞填] scanForm: schema 未加载');
      return [];
    }

    const index = buildSynonymIndex(schema);

    let elements;
    try {
      elements = document.querySelectorAll('input, select, textarea');
    } catch (e) {
      return [];
    }

    const results = [];
    const budgetMs = 4000;
    const start = Date.now();

    for (let i = 0; i < elements.length; i++) {
      if ((i & 31) === 0 && Date.now() - start > budgetMs) {
        console.warn('[简历飞填] 扫描超时,已处理 ' + i + '/' + elements.length);
        break;
      }

      const el = elements[i];
      if (!isFillable(el)) continue;

      const match = bestMatch(collectContext(el), index);
      if (!match) continue;

      let currentValue = '';
      const tag = el.tagName.toLowerCase();
      if (tag === 'select') {
        const opt = el.options && el.options[el.selectedIndex];
        currentValue = opt ? opt.text : '';
      } else {
        currentValue = el.value || '';
      }

      results.push({
        element: el,
        path: match.path,
        matchedSynonym: match.synonym,
        confidence: match.key.length >= 4 ? 'high' : 'medium',
        currentValue: currentValue
      });
    }

    return results;
  }

  const Matcher = { scanForm: scanForm, collectContext: collectContext, norm: norm };

  if (typeof window !== 'undefined') window.Matcher = Matcher;
  if (typeof self !== 'undefined') self.Matcher = Matcher;
})();
