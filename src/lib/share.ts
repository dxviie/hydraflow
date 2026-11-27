/**
 * A patch as a link: the saved patch, packed into the part of the address
 * after the `#`, which never leaves the browser that opens it.
 *
 * What comes back out of a link is read by `parsePatch` like any saved patch:
 * data, checked piece by piece, never run.
 */
import { parsePatch, type SavedPatch } from "./graph/storage";

const KEY = "patch=";
/** Deflated, then base64url */
const PACKED = "1.";
/** Base64url only, for a browser that can't deflate */
const PLAIN = "0.";

/** Longer than any patch needs: past these a link is not read */
const MAX_LINK = 200_000;
const MAX_UNPACKED = 2_000_000;

type Bytes = Uint8Array<ArrayBuffer>;

function toBase64Url(bytes: Bytes): string {
  let binary = "";
  for (let at = 0; at < bytes.length; at += 0x8000) {
    binary += String.fromCharCode(...bytes.subarray(at, at + 0x8000));
  }
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function fromBase64Url(text: string): Bytes | undefined {
  if (!/^[A-Za-z0-9_-]*$/.test(text)) return undefined;
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return Uint8Array.from(binary, (character) => character.charCodeAt(0));
}

async function deflate(bytes: Bytes): Promise<Bytes> {
  const stream = new Blob([bytes]).stream().pipeThrough(new CompressionStream("deflate-raw"));
  return new Uint8Array(await new Response(stream).arrayBuffer());
}

/** Unpack, giving up on anything that grows past the limit */
async function inflate(bytes: Bytes): Promise<Bytes | undefined> {
  const stream = new Blob([bytes]).stream().pipeThrough(new DecompressionStream("deflate-raw"));
  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.length;
    if (size > MAX_UNPACKED) {
      await reader.cancel();
      return undefined;
    }
    chunks.push(value);
  }
  const unpacked = new Uint8Array(size);
  let at = 0;
  for (const chunk of chunks) {
    unpacked.set(chunk, at);
    at += chunk.length;
  }
  return unpacked;
}

export async function encodePatch(patch: SavedPatch): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(patch));
  if (typeof CompressionStream === "undefined") return PLAIN + toBase64Url(bytes);
  return PACKED + toBase64Url(await deflate(bytes));
}

/** The patch in a link, or nothing if it isn't one we can read */
export async function decodePatch(encoded: string): Promise<SavedPatch | undefined> {
  if (encoded.length > MAX_LINK) return undefined;
  try {
    const bytes = fromBase64Url(encoded.slice(2));
    if (!bytes) return undefined;
    const unpacked = encoded.startsWith(PACKED)
      ? await inflate(bytes)
      : encoded.startsWith(PLAIN) && bytes.length <= MAX_UNPACKED
        ? bytes
        : undefined;
    if (!unpacked) return undefined;
    return parsePatch(JSON.parse(new TextDecoder().decode(unpacked)));
  } catch {
    // Cut short, mistyped or not ours
    return undefined;
  }
}

/** The link to a patch, from the address of the editor */
export function shareUrl(address: string, encoded: string): string {
  return `${address.split("#")[0]}#${KEY}${encoded}`;
}

/** The packed patch in an address's `#…` part, if it carries one */
export function linkedPatch(hash: string): string | undefined {
  const text = hash.replace(/^#/, "");
  return text.startsWith(KEY) ? text.slice(KEY.length) : undefined;
}
