import { useCallback, useEffect, useRef, useState } from 'react';

// Shared WebSocket endpoint used by Square of Shadows and Zombie Shooter.
const DEFAULT_WEBSOCKET_URL = 'wss://5ylvnxsm3i.execute-api.us-east-2.amazonaws.com/prod';
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || DEFAULT_WEBSOCKET_URL;

const parseMessage = (event) => {
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
};

const upsertPlayers = (previous = [], incoming = []) => {
  const byId = new Map(previous.filter((player) => player?.playerId).map((player) => [player.playerId, player]));
  for (const player of incoming) {
    if (!player?.playerId) continue;
    const old = byId.get(player.playerId) || {};
    byId.set(player.playerId, {
      ...old,
      ...player,
      position: player.position || old.position,
      direction: player.direction ?? old.direction,
      nickname: player.nickname || old.nickname || 'Player',
    });
  }
  return [...byId.values()];
};

/** Shared identity and movement socket for the two remaining game worlds. */
export function useLobby(userId, nickname) {
  const [players, setPlayers] = useState([]);
  const [status, setStatus] = useState('disconnected');
  const [isConnecting, setIsConnecting] = useState(false);
  const socketRef = useRef(null);
  const retryRef = useRef(null);
  const pingRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const lastMoveSentRef = useRef(0);
  const manualDisconnectRef = useRef(false);
  const connectRef = useRef(null);
  const listenersRef = useRef(new Set());

  const sendRaw = useCallback((payload) => {
    const socket = socketRef.current;
    if (!socket || socket.readyState !== WebSocket.OPEN) return;
    socket.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
  }, []);

  const subscribe = useCallback((listener) => {
    listenersRef.current.add(listener);
    return () => listenersRef.current.delete(listener);
  }, []);

  const sendMove = useCallback((position) => {
    if (!position || !Number.isFinite(position.x) || !Number.isFinite(position.y)) return;
    const now = Date.now();
    if (now - lastMoveSentRef.current < 100) return;
    lastMoveSentRef.current = now;

    const extras = {};
    const color = localStorage.getItem(`avatar_color_${userId}`) || '#4a90e2';
    const image = localStorage.getItem(`avatar_image_${userId}`) || null;
    const size = Number(localStorage.getItem(`avatar_size_${userId}`)) || 80;
    extras.avatarColor = color;
    extras.avatarImage = image;
    extras.avatarSize = size;

    sendRaw({
      action: 'move',
      playerId: userId,
      nickname: nickname || 'Player',
      position,
      direction: position.direction ?? 0,
      ...extras,
    });
  }, [nickname, sendRaw, userId]);

  const disconnectFromLobby = useCallback(() => {
    manualDisconnectRef.current = true;
    if (pingRef.current) window.clearInterval(pingRef.current);
    if (retryRef.current) window.clearTimeout(retryRef.current);
    pingRef.current = null;
    retryRef.current = null;
    const socket = socketRef.current;
    socketRef.current = null;
    socket?.close();
    setStatus('disconnected');
    setIsConnecting(false);
    setPlayers([]);
  }, []);

  const connectToLobby = useCallback(() => {
    if (!userId || isConnecting || status === 'connected') return;
    manualDisconnectRef.current = false;
    setIsConnecting(true);
    setPlayers([]);

    const token = localStorage.getItem('c888_id_token');
    const params = new URLSearchParams({ userId });
    if (token) params.set('token', token);
    if (nickname) params.set('nickname', nickname);
    params.set('avatarColor', localStorage.getItem(`avatar_color_${userId}`) || '#4a90e2');
    params.set('avatarSize', localStorage.getItem(`avatar_size_${userId}`) || '80');

    const socket = new WebSocket(`${WEBSOCKET_URL}?${params}`);
    socketRef.current = socket;
    setStatus('connecting');

    socket.addEventListener('open', () => {
      if (socketRef.current !== socket) return;
      setStatus('connected');
      setIsConnecting(false);
      lastActivityRef.current = Date.now();
      socket.send(JSON.stringify({ action: 'getSnapshot' }));
      pingRef.current = window.setInterval(() => {
        if (socket.readyState !== WebSocket.OPEN || socketRef.current !== socket) return;
        if (Date.now() - lastActivityRef.current > 90_000) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ action: 'ping' }));
      }, 25_000);
    });

    socket.addEventListener('message', (event) => {
      if (socketRef.current !== socket) return;
      const payload = parseMessage(event);
      lastActivityRef.current = Date.now();
      if (payload.type === 'snapshot') setPlayers(payload.players || []);
      if (payload.type === 'playerJoined' || payload.type === 'playerMoved') {
        setPlayers((previous) => upsertPlayers(previous, [payload.player]));
      }
      if (payload.type === 'playerLeft') {
        setPlayers((previous) => previous.filter((player) => player.playerId !== payload.playerId));
      }
      for (const listener of listenersRef.current) {
        try {
          listener(payload);
        } catch (error) {
          console.error('Game socket listener error:', error);
        }
      }
    });

    socket.addEventListener('close', () => {
      if (socketRef.current !== socket) return;
      socketRef.current = null;
      if (pingRef.current) window.clearInterval(pingRef.current);
      pingRef.current = null;
      setStatus('disconnected');
      setIsConnecting(false);
      if (!manualDisconnectRef.current) {
        retryRef.current = window.setTimeout(() => connectRef.current?.(), 3000);
      }
    });

    socket.addEventListener('error', (error) => {
      if (socketRef.current !== socket) return;
      console.error('Game socket error:', error);
      setStatus('error');
      setIsConnecting(false);
    });
  }, [isConnecting, nickname, status, userId]);

  useEffect(() => {
    connectRef.current = connectToLobby;
  }, [connectToLobby]);

  useEffect(() => () => {
    manualDisconnectRef.current = true;
    if (pingRef.current) window.clearInterval(pingRef.current);
    if (retryRef.current) window.clearTimeout(retryRef.current);
    socketRef.current?.close();
  }, []);

  return {
    players,
    status,
    isConnecting,
    sendRaw,
    sendMove,
    subscribe,
    connectToLobby,
    disconnectFromLobby,
  };
}

export default useLobby;
