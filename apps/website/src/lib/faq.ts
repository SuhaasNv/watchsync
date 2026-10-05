import { FROM_STORE } from "./site";

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

/** The same either way WatchSync was installed. */
const CAN_AND_CANT =
  "<p>Here is exactly what it can do, so you can decide. WatchSync keeps your name and room in your browser, talks to its own room service, checks GitHub at most once a day for a new version, and runs only on Netflix, Prime Video and JioHotstar pages, where it reads and controls playback. It can't read the video, your passwords or your browsing history, it doesn't run on other sites, it loads no code from the internet, and it has no analytics or ads.</p>";

/** Answers that mention installing switch with PUBLIC_STORE_URL (lib/site.ts). */
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
    id: "chat",
    q: "Can we chat while we watch?",
    a: "<p>Yes. Chat opens in a side panel next to the player, and each message shows the movie time it was sent at.</p>",
  },
  {
    id: "chat-saved",
    q: "Is my chat saved anywhere?",
    a: "<p>Only in memory while the room exists. It is never written to disk and is gone when the room ends.</p>",
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
    a: FROM_STORE
      ? `${CAN_AND_CANT}<p>WatchSync is published through the Chrome Web Store, which reviews extensions before they go live, and its code is <a href="https://github.com/SuhaasNv/watchsync" rel="noopener">public on GitHub</a>.</p>`
      : `${CAN_AND_CANT}<p>The code is <a href="https://github.com/SuhaasNv/watchsync" rel="noopener">public on GitHub</a>, and each release zip is built from it by GitHub Actions. Every release lists the SHA-256 of its zip, so you can check your download matches. The install guide's <a href="/install/#safe">Is it safe?</a> section explains each permission and gives the commands to check the file.</p>`,
  },
  {
    id: "developer-mode",
    q: FROM_STORE ? "Do I need Developer mode?" : "Why do I need Developer mode?",
    a: FROM_STORE
      ? '<p>No. Add WatchSync from the Chrome Web Store like any other extension. It works in Brave too.</p><p>If you can\'t use the Chrome Web Store, you can still <a href="/install/manual/">install it from the zip</a>, which does need Developer mode.</p>'
      : '<p>This guide loads WatchSync from the zip file yourself, and Chrome calls that Developer mode. It\'s a standard switch on the extensions page. Chrome then shows a banner about developer-mode extensions, which is expected.</p><p>Downloads come from our <a href="https://github.com/SuhaasNv/watchsync" rel="noopener">public GitHub</a>, where you can read the code. The <a href="/install/">install guide</a> shows every step.</p>',
  },
  {
    id: "update",
    q: "How do I update it?",
    a: FROM_STORE
      ? '<p>You don\'t need to. Chrome and Brave update extensions from the Chrome Web Store on their own. If you installed it from the zip, the <a href="/install/manual/#updating">zip guide</a> explains how to update it.</p>'
      : '<p>Download the new zip, replace the contents of your WatchSync folder with the new files, then press the reload arrow on the WatchSync card in <code>chrome://extensions</code>. The <a href="/install/#updating">install guide</a> has the details.</p>',
  },
  {
    id: "affiliated",
    q: "Is this made by Netflix, Amazon or JioStar?",
    a: "<p>No. WatchSync is an independent project and isn't affiliated with them. It works with their players in your own browser.</p>",
  },
];
