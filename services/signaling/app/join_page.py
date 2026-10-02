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
  body { margin: 0; min-height: 100vh; display: grid; place-items: center; background: #0c1215;
    color: #ecf2f1; font: 16px/1.5 -apple-system, system-ui, "Segoe UI", sans-serif; }
  main { width: min(560px, calc(100% - 32px)); padding: 32px 0; }
  h1 { font-size: 24px; line-height: 1.25; margin: 0 0 8px; }
  h2 { font-size: 18px; margin: 24px 0 8px; }
  p, li { color: #a9b8b9; margin: 0 0 12px; }
  a { color: #ecf2f1; }
  .code { font: 500 32px/1.2 ui-monospace, Menlo, monospace; letter-spacing: 0.2em;
    color: #ecf2f1; margin: 4px 0 20px; }
  ol, ul { padding-left: 20px; }
  code { color: #ecf2f1; }
  footer { margin-top: 32px; }
  footer p { font-size: 14px; }
  #watchsync-join { display: none; }
  form { display: flex; flex-direction: column; gap: 8px; }
  label { font-size: 14px; font-weight: 600; color: #a9b8b9; }
  input { height: 44px; border-radius: 12px; border: 1px solid rgba(214, 236, 240, 0.18);
    background: #19242a; color: #ecf2f1; padding: 0 12px; font: inherit; }
  button { height: 44px; border: 0; border-radius: 10px; background: #ffd25a; color: #1b1503;
    font: inherit; font-weight: 600; cursor: pointer; }
  button:disabled { opacity: 0.45; cursor: default; }
  [role="alert"] { color: #ff6b6b; font-size: 14px; }
  :focus-visible { outline: 2px solid #ffd25a; outline-offset: 2px; }
"""

FOOTER = """<footer>
  <p><a href="/privacy">Privacy</a> · <a href="/terms">Terms</a></p>
  <p>WatchSync is not affiliated with Netflix, Amazon (Prime Video) or JioStar (JioHotstar).</p>
</footer>"""


def page(title: str, description: str, body: str, preview: str = "") -> str:
    """One page with the shared head. Pages are private or legal, so never indexed."""
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
{body}
{FOOTER}
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


def render(code: str) -> str | None:
    code = code.upper()
    if not CODE.fullmatch(code):
        return None
    body = f"""  <h1>You're invited to watch together</h1>
  <p>Room code</p>
  <p class="code" id="code">{code}</p>
  <section id="install">
    <p>Already have WatchSync? Type the code in the WatchSync popup.</p>
    <p>New to WatchSync? Install it in Chrome, then open this link again:</p>
    <ol>
      <li>Ask your friend for the WatchSync zip file and unzip it.</li>
      <li>Open <code>chrome://extensions</code> and turn on Developer mode.</li>
      <li>Click Load unpacked and choose the unzipped folder.</li>
    </ol>
    <p>Each of you needs your own Netflix, Prime Video or JioHotstar account.
      If the room has ended, ask your friend for a new link.</p>
  </section>
  <section id="watchsync-join"></section>"""
    return page(
        "Join a WatchSync room",
        "Join your friend's WatchSync room and watch Netflix, Prime Video or JioHotstar in "
        "sync, each in your own tab.",
        body,
        INVITE_PREVIEW,
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
