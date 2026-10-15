// The manifest `key` of each build channel (US-133). With a fixed key, every install of the
// same zip gets the same extension ID whichever folder it is loaded from, so the microphone
// permission, the saved name and the settings survive replacing the folder with a newer
// version. The two channels have keys of their own so "WatchSync Dev" still installs next to
// the real WatchSync. These are the PUBLIC halves only (base64 of the DER SubjectPublicKeyInfo);
// the private keys live outside the repository and are only needed to pack a .crx or to prove
// ownership of the ID, never to build.
import { createHash } from "node:crypto";

export const KEYS = {
  prod: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAxCwhas/9+CowMfAn6rj/RGZffv7knw9Q31+QIY7ZrkXSjm/EwOMow9TZ+uN4RYNc2624bfzuMtdCiTSJEj1znHLJrt4VRmNw/GJYuvhaW7zfJ1lNlY5CY/FJfYYlx4M1Gjcs9DIVxa71RvCpY9NS6AqXbkS0yEfjIFWWeUnUvbPldT4y+vzhb7HIBALQiAciV22WlUdK1lxBDHZxsMPS7fYJOccBc2yMGxc9QDSZBT2vCVDTzl13X5u3V59ZxdCKA5kjLb7hZzRPR6mpLC4bLXdIbHS5vYQIb9pEG6ztI87tLwx/VRc8Gcoq0BdljGB3rYec3Dx9uCAG6HC5nN73NQIDAQAB",
  dev: "MIIBIjANBgkqhkiG9w0BAQEFAAOCAQ8AMIIBCgKCAQEAte2r+IBlro6ausTPZG+YbS3P3VT954NUZSFjRKmYByP46NOXJjb0g8Zk36MtajcGqXFTiw0YHW4DUOSmtBcZ8pK4j/azKJMYLZ88yoo9JqIHY/qaOeWLOyLBBOgXxeRLhIKti0BILzgKEnYjwZenLwJx9CJsfoQI5djDNC35wTMwPOd8eCINspGAgVQpnRPilwXvwtC6GChK30qc1YAxtsdgBCrT0Q6vhJu/cmLTRA6tA670XjcLX3ew4EgzxZlrqOp+3uJ/DYkNsQL+UlD1bNna5rfded3L1aJPiBjAq8fbRhja0oiNuqH5eIgBr5TIFPMdeGNB9fNIOE42I+U1lwIDAQAB",
};

/** The extension ID Chrome derives from a manifest key: SHA-256 of the DER, 32 hex digits as a-p. */
export function extensionId(key) {
  const hex = createHash("sha256").update(Buffer.from(key, "base64")).digest("hex").slice(0, 32);
  return [...hex].map((c) => String.fromCharCode(97 + Number.parseInt(c, 16))).join("");
}
