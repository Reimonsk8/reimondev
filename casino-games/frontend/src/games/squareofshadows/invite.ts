/**
 * Square of Shadows — invite links.
 *
 * A room code is the whole addressing scheme: short enough to read aloud, long
 * enough not to collide in practice, and safe to put in a chat message. The
 * link is just the SoS route plus `?room=`, so it survives being pasted into any
 * app and resolves on first load before the socket is even opened.
 *
 * The alphabet drops I/O/0/1 so a code read aloud ("B7KQ2M", not "B7KQZM") or
 * retyped from a screenshot cannot be mistranscribed.
 */

const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // no 0/1/I/O
const CODE_LENGTH = 6;

/** Cryptographically-random code; `crypto.getRandomValues` needs no dependency. */
export function makeRoomCode(length = CODE_LENGTH): string {
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += ALPHABET[bytes[i] % ALPHABET.length];
  }
  return out;
}

/** Normalise user input: uppercase, strip anything not in the alphabet, cap length. */
export function normalizeRoomCode(raw: string | null | undefined): string {
  if (!raw) return '';
  return raw
    .toUpperCase()
    .split('')
    .filter((ch) => ALPHABET.includes(ch))
    .slice(0, CODE_LENGTH)
    .join('');
}

export function isValidRoomCode(raw: string | null | undefined): boolean {
  return normalizeRoomCode(raw).length === CODE_LENGTH;
}

export const SOS_ROUTE = '/square-of-shadows';

export function roomInviteUrl(code: string, origin?: string): string {
  const base = origin ?? (typeof window !== 'undefined' ? window.location.origin : '');
  return `${base}${SOS_ROUTE}?room=${normalizeRoomCode(code)}`;
}

/** Pull a valid room code out of a `location.search` string. Returns '' when absent. */
export function parseRoomCode(search: string | null | undefined): string {
  if (!search) return '';
  const raw = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search).get('room');
  const code = normalizeRoomCode(raw);
  return code.length === CODE_LENGTH ? code : '';
}

/**
 * Prefill the host's nickname into the share text so the person receiving it
 * knows who is waiting without having to open the link first.
 */
export function inviteMessage(code: string, hostNickname?: string): string {
  const url = roomInviteUrl(code);
  const who = hostNickname?.trim() ? `${hostNickname.trim()} challenges you` : 'A challenge awaits';
  return `${who} in Square of Shadows — join my lobby: ${url} (room ${normalizeRoomCode(code)})`;
}

/**
 * Web Share API when available (mobile), clipboard as the fallback. Resolves to
 * the method actually used so the UI can say which.
 */
export async function shareInvite(
  code: string,
  hostNickname?: string,
): Promise<'shared' | 'copied' | 'failed'> {
  const text = inviteMessage(code, hostNickname);
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav?.share) {
    try {
      await nav.share({ title: 'Square of Shadows', text, url: roomInviteUrl(code) });
      return 'shared';
    } catch (err) {
      // AbortError = the user dismissed the sheet; not a failure to copy.
      if ((err as { name?: string })?.name === 'AbortError') return 'shared';
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch {
      /* fall through */
    }
  }

  return 'failed';
}