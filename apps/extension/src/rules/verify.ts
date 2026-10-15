// Checks a rules file against the bundled public key (DEC-038). Pure: bytes in, verdict out.
// Chrome's WebCrypto does Ed25519 from version 137; on anything older (or without WebCrypto)
// the key can't be imported and every file is refused, so the bundled rules stay in use.
import { parseRulesFile, type RulesFile } from "./schema";

/** The largest file or signature we read; a bigger answer is dropped before it is parsed. */
export const MAX_RULES_BYTES = 64 * 1024;
export const MAX_SIG_BYTES = 256;

export type Verdict =
  | { ok: true; file: RulesFile }
  | { ok: false; reason: "size" | "unsupported" | "signature" | "schema" };

/** Base64 to bytes; null when it isn't base64 (atob throws). */
function fromBase64(text: string): Uint8Array<ArrayBuffer> | null {
  try {
    return Uint8Array.from(atob(text.trim()), (c) => c.charCodeAt(0));
  } catch {
    return null;
  }
}

/**
 * The file if `signature` (base64, over the exact `body` bytes) was made by the key matching
 * `publicKey` (base64, raw 32 bytes) and the body is well-formed rules; otherwise why not.
 * Expiry and sequence are the caller's business (see update.ts).
 */
export async function verifyRules(
  body: Uint8Array<ArrayBuffer>,
  signature: string,
  publicKey: string,
  subtle: SubtleCrypto | undefined = globalThis.crypto?.subtle,
  selectorOk?: (selector: string) => boolean,
): Promise<Verdict> {
  if (body.length === 0 || body.length > MAX_RULES_BYTES || signature.length > MAX_SIG_BYTES)
    return { ok: false, reason: "size" };
  const raw = fromBase64(publicKey);
  const sig = fromBase64(signature);
  if (!subtle || !raw || raw.length !== 32) return { ok: false, reason: "unsupported" };
  if (!sig) return { ok: false, reason: "signature" };
  if (sig.length !== 64) return { ok: false, reason: "signature" };
  let valid = false;
  try {
    const key = await subtle.importKey("raw", raw, { name: "Ed25519" }, false, ["verify"]);
    valid = await subtle.verify({ name: "Ed25519" }, key, sig, body);
  } catch {
    return { ok: false, reason: "unsupported" }; // this Chrome has no Ed25519
  }
  if (!valid) return { ok: false, reason: "signature" };
  let data: unknown;
  try {
    data = JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
  } catch {
    return { ok: false, reason: "schema" };
  }
  const file = parseRulesFile(data, selectorOk);
  return file ? { ok: true, file } : { ok: false, reason: "schema" };
}
