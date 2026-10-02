/**
 * Questions friends actually ask. Answers are trusted HTML written here (links only), so
 * pages render them with set:html.
 */
export interface Faq {
  id: string;
  q: string;
  a: string;
  /** Shown on the home page as well as /faq. */
  teaser?: boolean;
}

export const FAQ: Faq[] = [
  {
    id: "free",
    q: "Is it free?",
    a: "<p>Yes. No account, no subscription and no ads. You only need your own subscription to the streaming service.</p>",
    teaser: true,
  },
  {
    id: "accounts",
    q: "Do my friends need their own accounts?",
    a: "<p>Yes. Each of you watches on your own Netflix, Prime Video or JioHotstar account, in your own browser tab. WatchSync passes play, pause and the position between you. It never shares the video itself.</p>",
    teaser: true,
  },
  {
    id: "video",
    q: "Does WatchSync see my video?",
    a: "<p>No. It reads and controls playback only: playing or paused, the position, the speed and which title is open. It never touches the picture, the sound, DRM or the stream, and it never records anything.</p>",
    teaser: true,
  },
  {
    id: "browsers",
    q: "Which browsers does it work in?",
    a: "<p>Chrome and Brave on a computer. Edge, Arc, Opera and other browsers built on Chromium will probably work too, but we haven't tested them yet. It doesn't run in Safari or Firefox.</p>",
    teaser: true,
  },
  {
    id: "phone",
    q: "Can I use it on my phone?",
    a: "<p>Not yet. WatchSync runs in Chrome or Brave on a laptop or desktop. If a friend sent you a link on your phone, open the same link on your computer.</p>",
  },
  {
    id: "people",
    q: "How many people can be in a room?",
    a: "<p>Up to eight.</p>",
  },
  {
    id: "live",
    q: "Can we watch live sports?",
    a: "<p>Not yet. Live streams aren't synced, and WatchSync tells you when you're on one. Films, shows and anything else on demand work.</p>",
  },
  {
    id: "ads",
    q: "What happens when someone gets an ad?",
    a: "<p>The room waits. Everyone else pauses at the same frame and sees why, for example “Maya is on an ad · about 0:20 left”. When it ends, everyone plays again together. WatchSync spots ads on Prime Video. On Netflix and JioHotstar it waits whenever someone's player is stuck loading.</p><p>If a wait runs past 90 seconds, the others can keep waiting or watch without that person.</p>",
  },
  {
    id: "wifi",
    q: "What if my Wi‑Fi drops?",
    a: "<p>WatchSync keeps trying and puts you back in your room on its own. If you restart your browser, you rejoin your room (WatchSync remembers it for up to 24 hours). If the room has ended, you'll see “This room is no longer available”: ask your friend for a new link.</p>",
  },
  {
    id: "safe",
    q: "Is it safe to install?",
    a: '<p>Here is exactly what it can do, so you can decide. WatchSync keeps your name and room in your browser, talks to its own room service, checks GitHub at most once a day for a new version, and runs only on Netflix, Prime Video and JioHotstar pages, where it reads and controls playback. It can\'t read the video, your passwords or your browsing history, it doesn\'t run on other sites, it loads no code from the internet, and it has no analytics or ads.</p><p>The code is <a href="https://github.com/SuhaasNv/watchsync" rel="noopener">public on GitHub</a>, and each release zip is built from it by GitHub Actions. Every release lists the SHA-256 of its zip, so you can check your download matches. The install guide\'s <a href="/install/#safe">Is it safe?</a> section explains each permission and gives the commands to check the file.</p>',
  },
  {
    id: "developer-mode",
    q: "Why do I need Developer mode?",
    a: '<p>WatchSync isn\'t on the Chrome Web Store yet, so you load it into your browser yourself, and Chrome calls that Developer mode. It\'s a standard switch on the extensions page. Chrome then shows a banner about developer-mode extensions, which is expected.</p><p>Downloads come from our <a href="https://github.com/SuhaasNv/watchsync" rel="noopener">public GitHub</a>, where you can read the code. The <a href="/install/">install guide</a> shows every step.</p>',
  },
  {
    id: "update",
    q: "How do I update it?",
    a: '<p>Download the new zip, replace the contents of your WatchSync folder with the new files, then press the reload arrow on the WatchSync card in <code>chrome://extensions</code>. The <a href="/install/#updating">install guide</a> has the details.</p>',
  },
  {
    id: "affiliated",
    q: "Is this made by Netflix, Amazon or JioStar?",
    a: "<p>No. WatchSync is an independent project and isn't affiliated with them. It works with their players in your own browser.</p>",
  },
];
