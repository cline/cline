import fitz  # PyMuPDF
from pathlib import Path

root = Path(r"c:\Users\bob43\Downloads\Bcline")
pdf_files = [root / "PRS 1.pdf", root / "PRS 2.pdf"]

for pdf_path in pdf_files:
    print(f"Processing: {pdf_path}")
    doc = fitz.open(pdf_path)
    parts = []
    for i, page in enumerate(doc, start=1):
        text = page.get_text()
        parts.append(f"# {pdf_path.stem} - Page {i}\n\n{text.strip()}\n")
    doc.close()
    md_content = "\n\n".join(parts).strip() + "\n"
    
    md_path = root / f"{pdf_path.stem}.md"
    md_path.write_text(md_content, encoding="utf-8")
    print(f"Created: {md_path}")
