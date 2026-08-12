"""OGP 画像（public/og.png）を原本から作り直す手動ユーティリティ。

  pip install Pillow
  python3 scripts/gen-og.py

原本 assets/og-source.png を 1200x630（OGP の標準比 1.91:1）へ縮小し、
256色へ減色して書き出す。減色は容量を4割ほど落とすが、
このデザインでは目視で劣化が分からない。

デプロイ経路には組み込まない。public/og.png はコミット済みの成果物で、
Python/Pillow は原本を差し替えるときにだけ要る。
"""

from PIL import Image

SRC = "assets/og-source.png"
DST = "public/og.png"

img = Image.open(SRC).convert("RGB").resize((1200, 630), Image.LANCZOS)
img.quantize(colors=256, method=Image.MEDIANCUT, dither=Image.FLOYDSTEINBERG).save(
    DST, optimize=True
)
print(f"{SRC} -> {DST}")
