// 端到端测试:用 jsdom 加载 test-form.html,跑真实的 matcher 逻辑
// 用法: node test-matcher.js
const fs = require('fs');
const path = require('path');
const { JSDOM } = require('jsdom');

const ROOT = __dirname;

// ---------- 1. 加载测试页 ----------
const html = fs.readFileSync(path.join(ROOT, 'test-form.html'), 'utf8');
const dom = new JSDOM(html, { runScripts: 'outside-only', pretendToBeVisual: true });
const { window } = dom;

// 补 jsdom 缺失的 offsetParent(让隐藏检测跳过,只测匹配逻辑)
Object.defineProperty(window.HTMLElement.prototype, 'offsetParent', {
  get() { return this.parentElement; }
});

// ---------- 2. 注入核心脚本 ----------
const schemaSrc = fs.readFileSync(path.join(ROOT, 'lib', 'resume-schema.js'), 'utf8');
const matcherSrc = fs.readFileSync(path.join(ROOT, 'lib', 'matcher.js'), 'utf8');

window.eval(schemaSrc);
window.eval(matcherSrc);

if (!window.ResumeSchema) { console.error('✗ ResumeSchema 未挂载'); process.exit(1); }
if (!window.Matcher)      { console.error('✗ Matcher 未挂载'); process.exit(1); }
console.log('✓ ResumeSchema / Matcher 加载成功');

// ---------- 3. 跑扫描 ----------
const t0 = Date.now();
let matches;
try {
  matches = window.Matcher.scanForm(window.ResumeSchema);
} catch (e) {
  console.error('✗ scanForm 抛异常:', e.message);
  process.exit(1);
}
const cost = Date.now() - t0;

console.log(`✓ 扫描完成: 识别 ${matches.length} 个字段, 耗时 ${cost}ms\n`);

// ---------- 4. 和简历数据对照 ----------
const resume = JSON.parse(fs.readFileSync(path.join(ROOT, 'resume-data.json'), 'utf8'));

function getVal(resume, pathStr) {
  return resolve(resume, pathStr.split('.'));
}

function resolve(cur, parts) {
  for (let i = 0; i < parts.length; i++) {
    const p = parts[i];
    if (cur === null || cur === undefined) return '';
    if (p === '*') {
      const rest = parts.slice(i + 1);
      if (Array.isArray(cur)) {
        for (const item of cur) {
          const v = resolve(item, rest);
          if (v !== '') return v;
        }
        return '';
      }
      continue;
    }
    cur = cur[p];
  }
  if (cur === null || cur === undefined) return '';
  if (Array.isArray(cur)) {
    if (!cur.length) return '';
    const f = cur[0];
    if (f && typeof f === 'object') return Object.values(f).filter(Boolean).join(' / ');
    return cur.filter(Boolean).join('、');
  }
  if (typeof cur === 'object') return Object.values(cur).filter(Boolean).join(' / ');
  return String(cur);
}

console.log('序号 | 匹配字段路径'.padEnd(34) + '| 命中关键词'.padEnd(22) + '| 将填入的值');
console.log('-'.repeat(110));
matches.forEach((m, i) => {
  const val = getVal(resume, m.path);
  const shown = val ? String(val).slice(0, 40) : '(空)';
  console.log(
    String(i + 1).padStart(3) + '  | ' +
    m.path.padEnd(32) + '| ' +
    String(m.matchedSynonym).padEnd(20) + '| ' +
    shown
  );
});

// ---------- 5. 覆盖率断言 ----------
const expectPaths = [
  'personal.name', 'personal.phone', 'personal.email',
  'personal.gender', 'personal.birthDate', 'personal.political',
  'education.*.school', 'education.*.major', 'education.*.degree',
  'selfIntro.summary'
];
const gotPaths = matches.map(m => m.path);
const missing = expectPaths.filter(p => !gotPaths.includes(p));

// 断言2: 列表字段必须能取到值(验证通配路径修复)
const listPaths = ['education.*.school', 'education.*.major', 'education.*.degree'];
const emptyList = listPaths.filter(p => {
  const m = matches.find(x => x.path === p);
  return !m || !getVal(resume, p);
});

// 断言3: "期望城市"不能被现居城市抢走
const expectCityMatch = matches.find(m => m.matchedSynonym === '期望城市');
const cityWrong = expectCityMatch && expectCityMatch.path !== 'jobIntention.desiredCity';

console.log('\n' + '-'.repeat(110));
console.log('【断言 1】关键字段识别');
if (missing.length === 0) {
  console.log('  ✓ 全部识别成功 (' + expectPaths.length + '/' + expectPaths.length + ')');
} else {
  console.log('  ✗ 未识别 (' + missing.length + '): ' + missing.join(', '));
}

console.log('【断言 2】列表字段取值(通配路径)');
if (emptyList.length === 0) {
  console.log('  ✓ 教育经历字段均可取值');
} else {
  console.log('  ✗ 取不到值: ' + emptyList.join(', '));
}

console.log('【断言 3】同义关键词消歧');
if (cityWrong) {
  console.log('  ✗ "期望城市" 被误判为 ' + expectCityMatch.path);
} else if (expectCityMatch) {
  console.log('  ✓ "期望城市" 正确匹配到 ' + expectCityMatch.path);
} else {
  console.log('  - 未出现"期望城市"(可能页面结构不同)');
}

const fillable = matches.filter(m => getVal(resume, m.path)).length;
console.log('\n汇总: 识别 ' + matches.length + ' 个字段,可填入非空值 ' + fillable + ' 个');

const allPass = missing.length === 0 && emptyList.length === 0 && !cityWrong;
console.log(allPass ? '\n★ 全部通过 ★' : '\n✗ 存在失败项');
process.exit(allPass ? 0 : 1);
