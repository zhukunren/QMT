"""Build the bundled static Chinese report font; not needed at application runtime."""
from hashlib import sha256
from pathlib import Path
from urllib.request import urlopen
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
import io

root = Path(__file__).resolve().parents[1]
target = root / "apps/api/assets/fonts"
target.mkdir(parents=True, exist_ok=True)
base = "https://raw.githubusercontent.com/google/fonts/main/ofl/notosanssc/"
raw = urlopen(base + "NotoSansSC%5Bwght%5D.ttf", timeout=90).read()
font = instantiateVariableFont(TTFont(io.BytesIO(raw)), {"wght": 400}, inplace=True)
# Rename the derived static font; preserve copyright and license metadata.
for record in font["name"].names:
    if record.nameID in (1, 4, 6, 16, 17):
        value = "QmtReportSans-Regular" if record.nameID == 6 else "Qmt Report Sans"
        if record.nameID == 17:
            value = "Regular"
        record.string = value.encode(record.getEncoding())
font.save(target / "QmtReportSans-Regular.ttf")
(target / "OFL.txt").write_bytes(urlopen(base + "OFL.txt", timeout=30).read())
(target / "README.md").write_text(
    "# Report font\n\n"
    "QmtReportSans-Regular.ttf is a static weight-400 derivative of Google's Noto Sans SC.\n"
    "Source: " + base + "NotoSansSC%5Bwght%5D.ttf\n\n"
    "Source SHA-256: `" + sha256(raw).hexdigest() + "`.\n\n"
    "Licensed under SIL Open Font License 1.1; see OFL.txt. "
    "The font is bundled and subset-embedded in PDF reports; runtime downloads are unnecessary.\n"
    "To regenerate: `python -m pip install fonttools` then `python scripts/prepare-report-font.py`.\n",
    encoding="utf-8",
)
print("Prepared bundled Chinese PDF font:", (target / "QmtReportSans-Regular.ttf").stat().st_size, "bytes")
