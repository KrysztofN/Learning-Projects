import io
import json
import math
import sys
import urllib.request
from pathlib import Path

from PIL import Image

ROOT = Path(__file__).resolve().parent.parent
PRIVATE = ROOT / "tools" / "private"
OUT = PRIVATE / "maps"
TILE = 256
WIDTH, HEIGHT = 900, 600
URL = "https://tile.openstreetmap.org/{z}/{x}/{y}.png"

PLACES = json.loads((PRIVATE / "places.json").read_text(encoding="utf-8"))


def global_pixel(lat, lon, zoom):
    n = 2 ** zoom * TILE
    x = (lon + 180) / 360 * n
    lat_rad = math.radians(lat)
    y = (1 - math.log(math.tan(lat_rad) + 1 / math.cos(lat_rad)) / math.pi) / 2 * n
    return x, y


def fetch(z, x, y):
    req = urllib.request.Request(URL.format(z=z, x=x, y=y), headers={"User-Agent": "wedding-static-map/1.0 (www.19-08-2027.pl)"})
    with urllib.request.urlopen(req) as r:
        return Image.open(io.BytesIO(r.read())).convert("RGB")


def render(name, lat, lon, zoom):
    cx, cy = global_pixel(lat, lon, zoom)
    left, top = cx - WIDTH / 2, cy - HEIGHT / 2
    tx0, ty0 = int(left // TILE), int(top // TILE)
    tx1, ty1 = int((left + WIDTH) // TILE), int((top + HEIGHT) // TILE)

    canvas = Image.new("RGB", ((tx1 - tx0 + 1) * TILE, (ty1 - ty0 + 1) * TILE))
    for tx in range(tx0, tx1 + 1):
        for ty in range(ty0, ty1 + 1):
            canvas.paste(fetch(zoom, tx, ty), ((tx - tx0) * TILE, (ty - ty0) * TILE))

    ox, oy = round(left - tx0 * TILE), round(top - ty0 * TILE)
    out = canvas.crop((ox, oy, ox + WIDTH, oy + HEIGHT))
    OUT.mkdir(parents=True, exist_ok=True)
    path = OUT / f"{name}.jpg"
    out.save(path, "JPEG", quality=82, optimize=True, progressive=True)
    print(f"{path.relative_to(ROOT)}  {lat}, {lon}  z{zoom}")


if __name__ == "__main__":
    names = sys.argv[1:] or PLACES.keys()
    for name in names:
        render(name, *PLACES[name])
