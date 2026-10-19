"""Inspect generated PDFs in tests without depending on a GUI viewer."""
import io
import json
import sys
from pypdf import PdfReader

reader = PdfReader(io.BytesIO(sys.stdin.buffer.read()))
fonts = set()
for page in reader.pages:
    for font in page.get("/Resources", {}).get("/Font", {}).get_object().values():
        obj = font.get_object()
        descriptor = obj.get("/FontDescriptor")
        if descriptor:
            descriptor = descriptor.get_object()
            if any(key in descriptor for key in ("/FontFile", "/FontFile2", "/FontFile3")):
                fonts.add(str(obj.get("/BaseFont")))
print(json.dumps({"pages": len(reader.pages), "text": "\n".join(page.extract_text() for page in reader.pages), "embeddedFonts": sorted(fonts)}, ensure_ascii=True))
