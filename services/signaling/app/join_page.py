"""The invite link page, /j/{code}. The extension's join-page script takes it over."""

import re

CODE = re.compile(r"[A-HJ-NP-Z2-9]{6}")

# No scripts: the page itself only explains; the extension adds the Join form.
CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self'; frame-ancestors 'none'"

_PAGE = """<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>Join a WatchSync room</title>
<style>
  :root {{ color-scheme: dark; }}
  body {{ margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c1215;
    color: #ecf2f1; font: 16px/1.5 -apple-system, system-ui, sans-serif; }}
  main {{ width: min(440px, calc(100% - 32px)); padding: 32px 0; }}
  h1 {{ font-size: 24px; line-height: 1.25; margin: 0 0 8px; }}
  p, li {{ color: #a9b8b9; margin: 0 0 12px; }}
  .code {{ font: 500 32px/1.2 ui-monospace, Menlo, monospace; letter-spacing: 0.2em; color: #ecf2f1;
    margin: 20px 0; }}
  ol {{ padding-left: 20px; }}
  code {{ color: #ecf2f1; }}
  #watchsync-join {{ display: none; }}
  h2 {{ font-size: 20px; margin: 0 0 8px; }}
  form {{ display: flex; flex-direction: column; gap: 8px; }}
  label {{ font-size: 14px; font-weight: 600; color: #a9b8b9; }}
  input {{ height: 44px; border-radius: 12px; border: 1px solid rgba(214, 236, 240, 0.18);
    background: #19242a; color: #ecf2f1; padding: 0 12px; font: inherit; }}
  button {{ height: 44px; border: 0; border-radius: 10px; background: #ffd25a; color: #1b1503;
    font: inherit; font-weight: 600; cursor: pointer; }}
  button:disabled {{ opacity: 0.45; cursor: default; }}
  [role="alert"] {{ color: #ff6b6b; font-size: 14px; }}
  :focus-visible {{ outline: 2px solid #ffd25a; outline-offset: 2px; }}
</style>
</head>
<body>
<main>
  <h1>You're invited to watch together</h1>
  <p>Room code</p>
  <p class="code" id="code">{code}</p>
  <section id="install">
    <p>To join, install the WatchSync extension in Chrome, then open this link again.</p>
    <ol>
      <li>Ask your friend for the WatchSync zip file and unzip it.</li>
      <li>Open <code>chrome://extensions</code> and turn on Developer mode.</li>
      <li>Click Load unpacked and choose the unzipped folder.</li>
    </ol>
    <p>You also need your own Netflix, Prime Video or JioHotstar account.
      Or type the code in the WatchSync popup.</p>
  </section>
  <section id="watchsync-join"></section>
</main>
</body>
</html>
"""


def render(code: str) -> str | None:
    code = code.upper()
    return _PAGE.format(code=code) if CODE.fullmatch(code) else None
