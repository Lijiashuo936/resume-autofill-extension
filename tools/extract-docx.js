// 纯 Node 提取 docx 文本(无需 pandoc)
// 用法: node extract-docx.js <input.docx> <output.md>
const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const [, , input, output] = process.argv;
if (!input || !output) {
  console.error('用法: node extract-docx.js <input.docx> <output.md>');
  process.exit(1);
}

// docx 是 zip,但 Node 22 没内置 zip 库。可以用 stream + 自解压,
// 但更简单的方式是按字节扫描中央目录。
// 工程上不优雅,改用 unzip-via-stream: 通过 PowerShell 的 Expand-Archive。

// 实际上为了让脚本可移植,我们直接调 PowerShell Expand-Archive,
// 它能解压标准 zip 文件。

const tmpDir = path.join(path.dirname(output), '.docx-extracted');
if (fs.existsSync(tmpDir)) {
  fs.rmSync(tmpDir, { recursive: true, force: true });
}
fs.mkdirSync(tmpDir, { recursive: true });

const { spawnSync } = require('child_process');

const expand = spawnSync('powershell', [
  '-NoProfile', '-Command',
  `Expand-Archive -LiteralPath "${input.replace(/"/g, '\\"')}" -DestinationPath "${tmpDir}" -Force`
], { encoding: 'utf8' });

if (expand.status !== 0) {
  console.error('解压失败:', expand.stderr);
  process.exit(1);
}

// 读取 word/document.xml
const docXmlPath = path.join(tmpDir, 'word', 'document.xml');
if (!fs.existsSync(docXmlPath)) {
  console.error('没找到 word/document.xml');
  process.exit(1);
}

const xml = fs.readFileSync(docXmlPath, 'utf8');

// 提取 <w:t> 内容,再用换行合并段落
// 段落结束符 </w:p> → 用 \n
let out = '';
let inText = false;
let buf = '';
for (let i = 0; i < xml.length; i++) {
  const c = xml[i];
  if (xml.startsWith('<w:t', i)) {
    inText = true;
    buf = '';
    continue;
  }
  if (xml.startsWith('</w:t', i)) {
    inText = false;
    out += escapeMarkdown(buf);
    i += 5; // skip </w:t>
    continue;
  }
  if (xml.startsWith('</w:p', i)) {
    out += '\n';
    i += 4;
    continue;
  }
  if (xml.startsWith('<w:tab', i)) {
    if (inText) out += '\t';
    i += 6;
    continue;
  }
  if (xml.startsWith('<w:br', i)) {
    if (inText) out += '\n';
    i += 5;
    continue;
  }
}

fs.writeFileSync(output, out, 'utf8');
console.log(`已写入 ${output} (${out.length} 字符)`);

// 清理临时目录
try { fs.rmSync(tmpDir, { recursive: true, force: true }); } catch {}

function escapeMarkdown(s) {
  return s; // 简化: 直接输出
}
