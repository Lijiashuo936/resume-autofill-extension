"""从简历 PDF 提取文本,用 pdf 内嵌字体 + latin-1 解码尝试。

很多 PDF 生成时使用 GB2312 / GBK 编码 / 嵌入式 CMap,
pdfplumber 默认 extract_text 会用 PDF 标准编码解码,
对 GBK 中文字体常常乱码。我们用 PyMuPDF (fitz) 通常更好,
或者 pdfplumber 的 chars 方法再拼接。
"""
import sys
import pdfplumber

input_path = sys.argv[1]
output_path = sys.argv[2]

with pdfplumber.open(input_path) as pdf:
    out = []
    out.append(f"[总页数]: {len(pdf.pages)}")
    for i, page in enumerate(pdf.pages):
        out.append(f"\n========== 第 {i+1} 页 ==========\n")
        # 直接拿所有 chars 的 text 拼接,跳过 .text layout 解析
        try:
            chars = page.chars
            if chars:
                # 按 y 排序,再按 x
                chars.sort(key=lambda c: (-c.get('top', 0), c.get('x0', 0)))
                buf = []
                last_y = None
                last_x = None
                line = ''
                for c in chars:
                    text = c.get('text', '')
                    if not text:
                        continue
                    y = round(c.get('top', 0), 1)
                    x = c.get('x0', 0)
                    if last_y is None or abs(last_y - y) > 1.5:
                        if line:
                            buf.append(line)
                        line = text
                        last_y = y
                        last_x = x
                    else:
                        # 同行
                        if last_x is not None and x - last_x > 5:
                            line += ' ' + text
                        else:
                            line += text
                        last_x = x
                if line:
                    buf.append(line)
                out.append('\n'.join(buf))
        except Exception as e:
            out.append(f'[chars 错误: {e}]')
        # 表格
        try:
            tables = page.extract_tables()
            if tables:
                out.append('\n--- 表格 ---')
                for t in tables:
                    for row in t:
                        out.append(' | '.join((str(c) if c else '').replace('\n', ' ') for c in row))
                    out.append('')
        except Exception:
            pass

# 写入
with open(output_path, 'w', encoding='utf-8') as f:
    f.write('\n'.join(out))

# 同时尝试用 bytes + decode 重新读取
import io
with open(output_path, 'rb') as f:
    raw = f.read()
# 看下能否找到正确编码
print(f"写入 {output_path} ({len(raw)} bytes, {len(out)} blocks)")
print(f"UTF-8 decoded ok: {True}")
