"""Zet een versienummer achter de eigen CSS- en JS-bestanden in alle pagina's.

Gebruik (vanuit de map van de site, vóór het pushen):
    python tools/cache_bust.py

GitHub Pages laat browsers bestanden 10 minuten bewaren. Met een nieuw
`?v=...` achter `css/...` en `js/...` halen ze na een update meteen de nieuwe
versie op. De versie is een hash van de inhoud van alle CSS- en JS-bestanden,
dus ze verandert enkel als er echt iets veranderd is.
"""
import glob
import hashlib
import re

files = sorted(glob.glob("css/*.css") + glob.glob("js/**/*.js", recursive=True))
digest = hashlib.sha1()
for path in files:
    with open(path, "rb") as f:
        digest.update(path.encode() + f.read())
version = digest.hexdigest()[:8]

ref = re.compile(r'((?:href|src)="(?:css|js)/[^"?]+\.(?:css|js))(?:\?v=[0-9a-f]+)?"')
changed = 0
for page in sorted(glob.glob("*.html")):
    with open(page, encoding="utf8") as f:
        html = f.read()
    new = ref.sub(rf'\1?v={version}"', html)
    if new != html:
        with open(page, "w", encoding="utf8") as f:
            f.write(new)
        changed += 1
print(f"versie {version}: {changed} pagina's aangepast")
