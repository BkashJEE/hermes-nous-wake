#!/usr/bin/env python3
"""Build desktop/plugin.js from desktop/plugin.src.js by inlining art/frame-*.webp as data URIs."""
import base64, json, pathlib, re
HERE = pathlib.Path(__file__).parent
src = (HERE / 'desktop/plugin.src.js').read_text()
frames = {k: 'data:image/webp;base64,' + base64.b64encode((HERE / f'art/frame-{k}.webp').read_bytes()).decode() for k in ('closed', 'quarter', 'half', 'threeq', 'open')}
out, n = re.subn(r'/\*FRAMES\*/.*?/\*END\*/', lambda m: json.dumps(frames), src, flags=re.S)
assert n == 1, 'FRAMES marker missing'
css = (HERE / 'desktop/crt.css').read_text()
out, n = re.subn(r"/\*CSS\*/.*?/\*ENDCSS\*/", lambda m: json.dumps(css), out, flags=re.S)
assert n == 1, 'CSS marker missing'
pv = HERE / 'docs/preview'
(pv / 'crt.css').write_text(css)
out = out.replace('desktop/plugin.js is built from this file', 'this file is built from desktop/plugin.src.js', 1)
(HERE / 'desktop/plugin.js').write_text(out)
print(f'desktop/plugin.js {len(out) // 1024} KB')
