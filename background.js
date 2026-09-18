// 后台 Service Worker
//   - 提供空简历模板初始化
//   - 转发 popup ↔ content 消息
//   - 提供 AI(DeepSeek)调用接口,留作扩展

const DEFAULT_RESUME = {
  personal: {
    name: '', englishName: '', gender: '', birthDate: '',
    phone: '', email: '', ethnicity: '汉族', political: '群众',
    maritalStatus: '未婚', hukouLocation: '', currentCity: '',
    height: '', weight: '', idCard: ''
  },
  jobIntention: {
    desiredPosition: '', desiredIndustry: '', desiredCity: '',
    desiredSalary: '', availableDate: '', jobType: '全职'
  },
  education: [],
  experience: [],
  projects: [],
  skills: [],
  awards: [],
  certificates: [],
  languages: [],
  selfIntro: { summary: '', hobbies: '', strengths: '' }
};

// ---------- 安装时初始化 storage ----------
chrome.runtime.onInstalled.addListener(async () => {
  const { resume } = await chrome.storage.local.get(['resume']);
  if (!resume) {
    await chrome.storage.local.set({ resume: DEFAULT_RESUME, fillHistory: [] });
    console.log('[简历飞填] 已初始化默认简历模板');
  }
});

// ---------- 消息路由 ----------
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {

  // 从 popup 来的 "扫描 / 填充" 命令,转发到当前 active tab 的 content script
  if (msg.type === 'SCAN_AND_FILL') {
    chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
      if (!tabs[0]) return sendResponse({ ok: false, error: 'no active tab' });
      chrome.tabs.sendMessage(tabs[0].id, msg, sendResponse);
    });
    return true; // 异步
  }

  // 从 content / popup 来的简历读取/保存
  if (msg.type === 'GET_RESUME') {
    chrome.storage.local.get(['resume']).then(r => {
      sendResponse({ ok: true, resume: r.resume || DEFAULT_RESUME });
    });
    return true;
  }

  if (msg.type === 'SET_RESUME') {
    chrome.storage.local.set({ resume: msg.resume, updatedAt: Date.now() }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'GET_DEEPSEEK_KEY') {
    chrome.storage.local.get(['deepseekKey', 'useAI']).then(r => {
      sendResponse({ ok: true, deepseekKey: r.deepseekKey || '', useAI: !!r.useAI });
    });
    return true;
  }

  if (msg.type === 'SET_DEEPSEEK_KEY') {
    chrome.storage.local.set({ deepseekKey: msg.key, useAI: msg.useAI }).then(() => {
      sendResponse({ ok: true });
    });
    return true;
  }

  if (msg.type === 'PUSH_HISTORY') {
    chrome.storage.local.get(['fillHistory']).then(r => {
      const list = r.fillHistory || [];
      list.unshift({
        url: msg.url,
        title: msg.title,
        time: Date.now(),
        succeeded: msg.succeeded,
        failed: msg.failed,
        total: msg.total
      });
      // 最多保留 50 条
      chrome.storage.local.set({ fillHistory: list.slice(0, 50) });
    });
    sendResponse({ ok: true });
    return true;
  }

  // 预留: 调用 DeepSeek (用户填了 key 才生效,默认走规则匹配)
  if (msg.type === 'AI_MATCH') {
    handleAIMatch(msg).then(sendResponse);
    return true;
  }

  return false;
});

// ---------- DeepSeek 预留 ----------
async function handleAIMatch(msg) {
  const { deepseekKey, useAI } = await chrome.storage.local.get(['deepseekKey', 'useAI']);
  if (!useAI || !deepseekKey) {
    return { ok: false, error: 'AI 未启用或 Key 未配置' };
  }
  try {
    const resp = await fetch('https://api.deepseek.com/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer ' + deepseekKey
      },
      body: JSON.stringify({
        model: 'deepseek-chat',
        messages: [
          {
            role: 'system',
            content: '你是一个表单字段匹配助手。用户会给你一段简历数据(JSON)和一个网页表单的字段标签列表(JSON),请你把每个标签匹配到简历中最合适的字段名,返回 {"标签1":"personal.name", "标签2":"personal.phone", ...} 的 JSON。不要解释,只输出 JSON。'
          },
          {
            role: 'user',
            content: `简历: ${JSON.stringify(msg.resume || {})}\n表单字段: ${JSON.stringify(msg.labels || [])}`
          }
        ],
        temperature: 0,
        response_format: { type: 'json_object' }
      })
    });
    const data = await resp.json();
    let content = data.choices?.[0]?.message?.content || '{}';
    const obj = JSON.parse(content);
    return { ok: true, mapping: obj };
  } catch (e) {
    return { ok: false, error: e.message };
  }
}
