import { DEFAULT_ROOM_CAPACITY } from './room';

export interface SectorStatus {
  ok: boolean;
  roomId: string;
  players: number;
  capacity: number;
  full: boolean;
}

export function outlandsWsUrl(): string | null {
  const raw = import.meta.env.VITE_OUTLANDS_WS_URL;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

export function outlandsHealthUrl(wsUrl: string): string {
  const parsed = new URL(wsUrl);
  parsed.protocol = parsed.protocol === 'wss:' ? 'https:' : 'http:';
  parsed.pathname = '/health';
  parsed.search = '';
  parsed.hash = '';
  return parsed.toString();
}

export async function fetchSectorStatus(): Promise<SectorStatus | null> {
  const wsUrl = outlandsWsUrl();
  if (!wsUrl) return null;
  try {
    const response = await fetch(outlandsHealthUrl(wsUrl), { cache: 'no-store' });
    if (!response.ok) return null;
    const body = (await response.json()) as Partial<SectorStatus>;
    if (body.ok !== true) return null;
    const capacity =
      typeof body.capacity === 'number' && body.capacity > 0
        ? body.capacity
        : DEFAULT_ROOM_CAPACITY;
    const players = typeof body.players === 'number' ? Math.max(0, body.players) : 0;
    return {
      ok: true,
      roomId: typeof body.roomId === 'string' ? body.roomId : 'sector-07',
      players,
      capacity,
      full: body.full === true || players >= capacity,
    };
  } catch {
    return null;
  }
}
