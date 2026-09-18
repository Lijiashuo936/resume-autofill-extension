"""PyMuPDF 提取,处理中文字体更稳。"""
import sys, fitz

src = sys.argv[1]
out = sys.argv[2]
with fitz.open(src) as doc:
    chunks = [f"[页数]: {doc.page_count}"]
    for i, page in enumerate(doc):
        chunks.append(f"\n========== 第 {i+1} 页 ==========\n")
        chunks.append(page.get_text())
        # 表格
        tabs = page.find_tables()
        if tabs and tabs.tables:
            chunks.append("\n--- 表格 ---")
            for t in tabs.tables:
                for row in t.extract():
                    chunks.append(" | ".join((c or "").replace("\n"," ") for c in row))
                chunks.append("")
with open(out, "w", encoding="utf-8") as f:
    f.write("\n".join(chunks))
print(f"写入 {out}, {sum(len(c) for c in chunks)} 字符")