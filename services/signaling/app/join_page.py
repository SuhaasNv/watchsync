"""The room service's few web pages: the invite link /j/{code}, privacy, terms, and not found.
The extension's join-page script takes over the invite page when installed."""

import html
import re

CODE = re.compile(r"[A-HJ-NP-Z2-9]{6}")

# No scripts: the pages only explain; the extension adds the Join form.
CSP = "default-src 'none'; style-src 'unsafe-inline'; img-src 'self' data:; frame-ancestors 'none'"

# The WatchSync mark (a filled dot beside a ring), as the tab icon.
ICON = (
    "data:image/svg+xml,"
    "%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'%3E"
    "%3Crect width='32' height='32' rx='8' fill='%230c1215'/%3E"
    "%3Ccircle cx='11' cy='16' r='6' fill='%23ffd25a'/%3E"
    "%3Ccircle cx='21' cy='16' r='5' fill='none' stroke='%23ecf2f1' stroke-width='2'/%3E"
    "%3C/svg%3E"
)

STYLE = """
  :root { color-scheme: dark; }
  * { box-sizing: border-box; }
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c1215;
    color: #ecf2f1; font: 16px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif;
    -webkit-font-smoothing: antialiased; }
  main { width: min(560px, calc(100% - 32px)); padding: 32px 0; }
  .brand { display: flex; align-items: center; gap: 10px; margin: 0 0 24px; font-weight: 700;
    font-size: 16px; letter-spacing: -0.01em; color: #ecf2f1; }
  h1 { font-size: 26px; line-height: 1.2; letter-spacing: -0.02em; margin: 0 0 8px; }
  h2 { font-size: 18px; line-height: 1.3; margin: 24px 0 8px; }
  p, li { color: #a9b8b9; margin: 0 0 12px; }
  a { color: #ecf2f1; text-underline-offset: 2px; }
  ol, ul { padding-left: 20px; }
  code { font: 14px ui-monospace, Menlo, monospace; color: #ecf2f1; background: #19242a;
    padding: 1px 6px; border-radius: 6px; }
  footer { margin-top: 32px; }
  footer p { font-size: 14px; }
  :focus-visible { outline: 2px solid #ffd25a; outline-offset: 2px; }

  /* Invite page */
  .invite { max-width: 480px; margin: 0 auto; }
  .card { padding: 28px 24px; border-radius: 16px; background: #121a1e;
    box-shadow: inset 0 0 0 1px rgba(214, 236, 240, 0.09), 0 24px 64px rgba(0, 0, 0, 0.35); }
  .card > :last-child { margin-bottom: 0; }
  .code-tile { margin: 20px 0 24px; padding: 16px; border-radius: 12px; background: #19242a;
    text-align: center; box-shadow: inset 0 0 0 1px rgba(214, 236, 240, 0.09); }
  .code-label { margin: 0 0 4px; font-size: 12px; line-height: 16px; font-weight: 650;
    letter-spacing: 0.08em; text-transform: uppercase; }
  .code { margin: 0 -0.22em 0 0; font: 600 34px/1.15 ui-monospace, Menlo, monospace;
    letter-spacing: 0.22em; color: #ecf2f1; }
  .note { display: flex; gap: 10px; align-items: flex-start; padding: 12px 14px;
    border-radius: 12px; background: rgba(255, 210, 90, 0.08); color: #ecf2f1;
    box-shadow: inset 0 0 0 1px rgba(255, 210, 90, 0.22); }
  .note svg { flex: none; margin-top: 3px; color: #ffd25a; }
  .steps { counter-reset: step; list-style: none; padding: 0; margin: 0 0 16px;
    display: grid; gap: 12px; }
  .steps li { counter-increment: step; position: relative; padding-left: 36px; margin: 0; }
  .steps li::before { content: counter(step); position: absolute; left: 0; top: 0; width: 24px;
    height: 24px; border-radius: 50%; display: grid; place-items: center; background: #19242a;
    color: #ecf2f1; font-size: 13px; font-weight: 650; line-height: 1;
    box-shadow: inset 0 0 0 1px rgba(214, 236, 240, 0.18); }
  .trust { display: flex; gap: 12px; align-items: flex-start; margin: 16px 0 0;
    padding: 14px 16px; border-radius: 16px; font-size: 14px; line-height: 1.45;
    background: rgba(94, 216, 195, 0.06); box-shadow: inset 0 0 0 1px rgba(94, 216, 195, 0.18); }
  .trust svg { flex: none; margin-top: 1px; color: #5ed8c3; }
  .invite footer { text-align: center; }

  /* The extension's Join form and states (added by its join-page script) */
  #watchsync-join { display: none; }
  .join-form { display: flex; flex-direction: column; gap: 8px; }
  .join-form label { font-size: 14px; font-weight: 600; color: #a9b8b9; }
  .join-form input { height: 48px; border-radius: 12px; border: 0; background: #19242a;
    box-shadow: inset 0 0 0 1px rgba(214, 236, 240, 0.18); color: #ecf2f1; padding: 0 14px;
    font: inherit; }
  .join-form input:focus { box-shadow: inset 0 0 0 1px #ffd25a; }
  .join-form button { height: 48px; margin-top: 8px; border: 0; border-radius: 12px;
    background: #ffd25a; color: #1b1503; font: inherit; font-weight: 650; cursor: pointer; }
  .join-form button:hover:not(:disabled) { background: #ffdd80; }
  .join-form button:disabled { opacity: 0.45; cursor: default; }
  .join-form .hint { margin: 0; font-size: 14px; }
  .join-form [role="alert"] { margin: 0; color: #ff8f8f; font-size: 14px; }
  .join-form [role="alert"]:empty { display: none; }
  .state { display: flex; gap: 14px; align-items: flex-start; }
  .state h2 { margin: 6px 0 4px; }
  .state p { margin: 0; }
  .state-mark { flex: none; width: 40px; height: 40px; border-radius: 50%; display: grid;
    place-items: center; background: rgba(94, 216, 195, 0.14); color: #5ed8c3; }
  .busy { display: flex; gap: 12px; align-items: center; margin: 0; color: #ecf2f1; }
  .spinner { flex: none; width: 20px; height: 20px; border-radius: 50%;
    border: 2px solid rgba(214, 236, 240, 0.18); border-top-color: #ffd25a;
    animation: spin 0.8s linear infinite; }
  @keyframes spin { to { transform: rotate(360deg); } }
  @media (prefers-reduced-motion: reduce) { .spinner { animation: none; } }
"""

# The mark beside the name, drawn inline (the CSP allows no external images).
BRAND = """<p class="brand"><svg width="26" height="16" viewBox="0 0 26 16" aria-hidden="true">\
<circle cx="8" cy="8" r="7" fill="#ffd25a"/>\
<circle cx="18" cy="8" r="6" fill="none" stroke="#ecf2f1" stroke-width="2"/></svg>\
<span>WatchSync</span></p>"""

FOOTER = """<footer>
  <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  <p>WatchSync is not affiliated with Netflix, Amazon (Prime Video) or JioStar (JioHotstar).</p>
</footer>"""


def page(title: str, description: str, body: str, preview: str = "", wrap: str = "") -> str:
    """One page with the shared head. Pages are private or legal, so never indexed."""
    inner = f"{BRAND}\n{body}\n{FOOTER}"
    if wrap:
        inner = f'<div class="{wrap}">\n{inner}\n</div>'
    return f"""<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="robots" content="noindex, nofollow">
<title>{html.escape(title)}</title>
<meta name="description" content="{html.escape(description)}">
<link rel="icon" href="{ICON}">
{preview}<style>{STYLE}</style>
</head>
<body>
<main>
{inner}
</main>
</body>
</html>
"""


# How a shared invite link looks in chat apps (no image: a text preview).
INVITE_PREVIEW = """<meta property="og:type" content="website">
<meta property="og:site_name" content="WatchSync">
<meta property="og:title" content="You're invited to watch together">
<meta property="og:description" content="Open this link with the WatchSync extension to join \
the room.">
<meta name="twitter:card" content="summary">
<meta name="twitter:title" content="You're invited to watch together">
<meta name="twitter:description" content="Open this link with the WatchSync extension to \
join the room.">
"""

LAPTOP = """<svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true" fill="none" \
stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
<path d="M5 5.5h14v10H5zM2.5 19h19"/></svg>"""

SHIELD = """<svg width="20" height="20" viewBox="0 0 24 24" aria-hidden="true" fill="none" \
stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">\
<path d="M12 3l7.5 3v5.5c0 4.5-3.2 8.2-7.5 9.5-4.3-1.3-7.5-5-7.5-9.5V6zM8.8 12.2l2.2 2.2 4.2-4.4"/>\
</svg>"""


def render(code: str) -> str | None:
    code = code.upper()
    if not CODE.fullmatch(code):
        return None
    body = f"""  <div class="card">
  <h1>You're invited to watch together</h1>
  <div class="code-tile">
    <p class="code-label">Room code</p>
    <p class="code" id="code">{code}</p>
  </div>
  <section id="install">
    <p class="note">{LAPTOP}<span>Open this link on your computer (Chrome or Brave).</span></p>
    <p>Already have WatchSync? Type the code in the WatchSync popup.</p>
    <p>New to WatchSync? Install it in Chrome or Brave, then come back to this page:</p>
    <ol class="steps">
      <li>Ask your friend for the WatchSync zip file.</li>
      <li>Unzip it. On Windows, right-click the zip and choose Extract All. On a Mac,
        double-click it. Keep the folder somewhere you won't delete it.</li>
      <li>Type <code>chrome://extensions</code> in the address bar (in Brave,
        <code>brave://extensions</code>) and turn on Developer mode.</li>
      <li>Click Load unpacked and pick the extracted folder, the one with
        <code>manifest.json</code> inside.</li>
      <li>Refresh this page.</li>
    </ol>
    <p>Each of you needs your own Netflix, Prime Video or JioHotstar account.
      If the room has ended, ask your friend for a new link.</p>
  </section>
  <section id="watchsync-join" aria-live="polite"></section>
  </div>
  <p class="trust">{SHIELD}<span>WatchSync only sees whether the video is playing, where it is,
    and its title. It can't see your passwords, payments or other sites.</span></p>"""
    return page(
        "Join a WatchSync room",
        "Join your friend's WatchSync room and watch Netflix, Prime Video or JioHotstar in "
        "sync, each in your own tab.",
        body,
        INVITE_PREVIEW,
        wrap="invite",
    )


def not_found() -> str:
    body = """  <h1>That link doesn't work</h1>
  <p>This isn't a WatchSync room link. Check it with your friend, or ask them for a new one.</p>"""
    return page("Link not found · WatchSync", "This WatchSync link doesn't work.", body)


PRIVACY = """  <h1>Privacy notice</h1>
  <p>Last updated: 2 October 2026</p>
  <p>WatchSync is a browser extension that keeps friends' video players in step. It is run by
    Suhaas Nv. Questions, requests and complaints about your data:
    <a href="mailto:suhaasnvs@gmail.com">suhaasnvs@gmail.com</a>.</p>
  <h2>What WatchSync collects, and why</h2>
  <ul>
    <li>Your display name, so the people in your room can see who is there.</li>
    <li>A room code and a random token, so you can join your room and rejoin it.</li>
    <li>What you have open on a supported service: the service, the title or episode ID and
      name, and its link, so your room can line everyone up on the same title.</li>
    <li>Your player's state: playing or paused, position, speed, and whether it is loading or
      showing an ad, to keep everyone in step and let the room wait for you.</li>
    <li>Your IP address, held in memory only to stop abuse (rate limits).</li>
  </ul>
  <h2>What WatchSync does not collect</h2>
  <p>No passwords or service account details, no viewing history, no video or audio, no
    cookies, no analytics, no advertising.</p>
  <h2>Who can see it</h2>
  <p>The people in your room see your name, which service and title you have open, and whether
    you are in sync, loading or on an ad. The room service runs on Railway in the United
    States. Nobody else receives your data, and it is never sold.</p>
  <p>Once a day the extension asks GitHub whether a newer version of WatchSync is out. GitHub
    sees that request like any visit to a web page, including your IP address; nothing about
    you or your room is sent with it.</p>
  <h2>How long it is kept</h2>
  <ul>
    <li>Rooms live in the service's memory only. When you leave a room, your entry is deleted
      at once.</li>
    <li>A room is deleted about 15 minutes after the last person leaves. Every restart of the
      service deletes all rooms.</li>
    <li>Codes of ended rooms (no personal data) are kept for 24 hours, so a late friend learns
      the room ended.</li>
    <li>On your computer, Chrome keeps your name, and your last room for up to 24 hours so you
      can rejoin. Leaving the room or removing the extension deletes them.</li>
  </ul>
  <h2>Your choices and rights</h2>
  <p>You can leave a room or remove the extension at any time. You can ask to see, correct or
    delete your data, or withdraw your consent, by writing to the address above. If you are in
    India you may complain to the Data Protection Board of India; in the EU, to your data
    protection authority.</p>
  <h2>Age</h2>
  <p>WatchSync is for people aged 18 and over.</p>
  <h2>Changes</h2>
  <p>If this notice changes, the date above changes.</p>"""

TERMS = """  <h1>Terms of use</h1>
  <p>Last updated: 2 October 2026</p>
  <ol>
    <li>WatchSync is a free tool, provided as is, without warranties. It may stop working, for
      example when a streaming service changes its player.</li>
    <li>Each person uses their own account on the streaming service and must follow that
      service's terms. WatchSync gives no access to content you don't already have.</li>
    <li>Use WatchSync for private viewing with people you know. Don't use it to show content to
      the public or to people without their own access.</li>
    <li>Don't misuse the room service: no attempts to disrupt rooms, guess room codes, or
      overload it.</li>
    <li>You must be 18 or over.</li>
    <li>Contact: <a href="mailto:suhaasnvs@gmail.com">suhaasnvs@gmail.com</a>.</li>
  </ol>"""


def privacy() -> str:
    return page("Privacy · WatchSync", "What WatchSync collects, why, and for how long.", PRIVACY)


def terms() -> str:
    return page("Terms · WatchSync", "The terms for using WatchSync.", TERMS)
