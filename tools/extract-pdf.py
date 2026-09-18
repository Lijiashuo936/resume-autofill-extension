"""从简历 PDF 提取文本,保留布局。"""
import sys
import pdfplumber

input_path = sys.argv[1]
output_path = sys.argv[2]

with pdfplumber.open(input_path) as pdf:
    out_lines = [f"[页数]: {len(pdf.pages)}"]
    for i, page in enumerate(pdf.pages):
        out_lines.append(f"\n========== 第 {i+1} 页 ==========\n")
        text = page.extract_text(layout=True) or ""
        out_lines.append(text)
        # 表格单独提取
        tables = page.extract_tables()
        if tables:
            out_lines.append("\n--- 表格 ---")
            for t_idx, t in enumerate(tables):
                for r_idx, row in enumerate(t):
                    out_lines.append(" | ".join(str(c) if c else "" for c in row))
                out_lines.append("")

with open(output_path, "w", encoding="utf-8") as f:
    f.write("\n".join(out_lines))

print(f"写入 {output_path} ({len(''.join(out_lines))} 字符)")
