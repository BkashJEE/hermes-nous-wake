# Paste only the eye area of the closed/half frames onto the open frame, so hair and face never move.
import numpy as np
from PIL import Image, ImageFilter, ImageDraw
base = Image.open('ink-open.png').convert('L')
W, H = base.size
m = Image.new('L', (W, H), 0)
d = ImageDraw.Draw(m)
for cx in (W * 0.27, W * 0.73):          # both eyes
    d.ellipse([cx - 340, 520, cx + 340, 915], fill=255)
m0 = m.copy()
m = m.filter(ImageFilter.GaussianBlur(14))
a = np.array(m); a[:600] = 0; a[600:760][a[600:760] > 0] = 255   # hard top edge under the fringe: no half-blended crease
m = Image.fromarray(a)
for st in ('closed', 'quarter', 'half', 'threeq'):
    src = Image.open(f'ink-{st}.png').convert('L').resize((W, H))
    out = Image.composite(src, base, m)
    # above the hard edge, lighten-blend: hair is black in both frames and stays black,
    # the open frame's eyelid crease is only black in one and disappears
    o, b, sr = np.array(out), np.array(base), np.array(src)
    band = np.zeros_like(o, bool); band[500:600] = True
    band &= np.array(Image.new('L', (W, H), 0)) == 0
    ell = np.array(m0) > 0
    sel = band & ell
    o[sel] = np.maximum(b[sel], sr[sel])
    out = Image.fromarray(o)
    out.save(f'../frame-{st}.png')
base.save('../frame-open.png')
m.save('mask.png')
