from pathlib import Path
from urllib.parse import quote

import segno

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "tools" / "private"
OUT = PRIVATE / "qr"
SITE = "https://www.19-08-2027.pl/"

OUT.mkdir(parents=True, exist_ok=True)
for line in (PRIVATE / "passwords.txt").read_text(encoding="utf-8").splitlines():
    if not line.strip():
        continue
    group, password = (s.strip() for s in line.split(":", 1))
    url = SITE + "#k=" + quote(password, safe="-_.!~*'()")
    qr = segno.make(url, error="q")
    qr.save(OUT / f"{group}.svg", scale=10, border=4)
    qr.save(OUT / f"{group}.png", scale=20, border=4)
    print(f"{group.ljust(7)} {url}")
