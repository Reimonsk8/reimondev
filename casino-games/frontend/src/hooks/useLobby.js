import { useEffect, useState, useRef, useCallback } from 'react';

// CloudFormation output `WebSocketApiUrl` for `CasinoInfraStack`.
const DEFAULT_WEBSOCKET_URL = 'wss://vbgum6fbrg.execute-api.us-east-2.amazonaws.com/prod';
const WEBSOCKET_URL = import.meta.env.VITE_WEBSOCKET_URL || DEFAULT_WEBSOCKET_URL;
const DEFAULT_AVATAR_SIZE = 80;

const parseMessage = (event) => {
  try {
    return JSON.parse(event.data);
  } catch {
    return {};
  }
};

const upsertPlayers = (prev = [], incoming = []) => {
  const byId = new Map();
  prev.forEach((player) => {
    if (player?.playerId) {
      byId.set(player.playerId, player);
    }
  });

  incoming.forEach((player) => {
    if (!player?.playerId) return;
    const existing = byId.get(player.playerId) || {};
    byId.set(player.playerId, {
      ...existing,
      ...player,
      position: player.position || existing.position,
      direction: player.direction ?? existing.direction,
      nickname: player.nickname || existing.nickname || 'Player',
    });
  });

  return Array.from(byId.values());
};

export function useLobby(userId, nickname) {
const [players, setPlayers] = useState([]);
const [emotes, setEmotes] = useState([]);
const [status, setStatus] = useState('disconnected'); // Start as disconnected
  const [isConnecting, setIsConnecting] = useState(false); // Manual connection state
  const socketRef = useRef(null);
  const retryRef = useRef(null);
  const pingIntervalRef = useRef(null);
  const lastActivityRef = useRef(Date.now());
  const manualDisconnectRef = useRef(false);
  const connectToLobbyRef = useRef(null);
  // playerIds that just left - ignore late move/join messages for ~8s so a
  // delayed broadcast (out-of-order vs playerLeft/snapshot) can't re-add a ghost.
  const recentlyLeftRef = useRef({});
  const isRecentlyLeft = (id) =>
    !!id && recentlyLeftRef.current[id] && Date.now() - recentlyLeftRef.current[id] < 8000;
  const lastMoveSentRef = useRef(0);
  // Client-side throttle so a player at ~30 msg/s doesn't fan out N broadcasts
  // per move; 100ms = 10 moves/s is smooth with server-side interpolation.
  const MOVE_SEND_INTERVAL = 100;
  const [token, setToken] = useState(() => localStorage.getItem('c888_id_token'));
  const avatarMetaRef = useRef({
    color: null,
    image: null,
    size: DEFAULT_AVATAR_SIZE,
  });

  // Chat state
  const [messages, setMessages] = useState([]);
  const [selfProfile, setSelfProfile] = useState({
    avatarColor: null,
    avatarImage: null,
    avatarSize: DEFAULT_AVATAR_SIZE,
  });

  // Generic outbound/inbound bridge for game messages (e.g. multiplayer blackjack)
  const messageListenersRef = useRef(new Set());

const sendRaw = useCallback((payload) => {
if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
socketRef.current.send(typeof payload === 'string' ? payload : JSON.stringify(payload));
}, []);

const sendGameStatus = useCallback((game) => {
sendRaw({ action: 'gameStatus', type: 'gameStatus', playerId: userId, game: game || null });
}, [sendRaw, userId]);

const sendEmote = useCallback((emote, avatarColor) => {
sendRaw({
action: 'emote',
type: 'emote',
playerId: userId,
nickname: nickname || 'Player',
avatarColor: avatarColor || null,
emote,
});
}, [sendRaw, userId, nickname]);

  const subscribe = useCallback((cb) => {
    messageListenersRef.current.add(cb);
    return () => messageListenersRef.current.delete(cb);
  }, []);

  useEffect(() => {
    // Refresh token when user context changes (e.g., after login)
    const nextToken = localStorage.getItem('c888_id_token');
    setToken(nextToken);
  }, [userId]);

  const sendMove = useCallback(
    (position) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;

      const now = Date.now();
      if (now - lastMoveSentRef.current < MOVE_SEND_INTERVAL) return;
      lastMoveSentRef.current = now;

      const avatarColor = localStorage.getItem(`avatar_color_${userId}`) || '#4a90e2';
      const avatarImage = localStorage.getItem(`avatar_image_${userId}`) || null;
      const avatarSizeRaw = localStorage.getItem(`avatar_size_${userId}`);
      const avatarSize = avatarSizeRaw ? Number(avatarSizeRaw) : DEFAULT_AVATAR_SIZE;

      const payloadExtras = {};
      if (
        avatarMetaRef.current.color !== avatarColor
        || avatarMetaRef.current.image !== avatarImage
        || avatarMetaRef.current.size !== avatarSize
      ) {
        avatarMetaRef.current = {
          color: avatarColor,
          image: avatarImage,
          size: avatarSize,
        };
        payloadExtras.avatarColor = avatarColor;
        payloadExtras.avatarImage = avatarImage;
        payloadExtras.avatarSize = avatarSize;
      }

      socketRef.current.send(
        JSON.stringify({
          action: 'move',
          type: 'move',
          playerId: userId,
          nickname: nickname || 'Player',
          position,
          direction: position?.direction ?? 0,
          isSmoking: position?.isSmoking ?? false,
          smokeStart: position?.smokeStart ?? null,
          seated: position?.seated ?? false,
          ...payloadExtras,
        }),
      );
    },
    [userId],
  );

  const sendChat = useCallback(
    (message) => {
      if (!socketRef.current || socketRef.current.readyState !== WebSocket.OPEN) return;
      // We use action: 'chat' if the backend maps it to the message lambda,
      // or we can just use action: 'message' if that's what's configured.
      // Based on previous files, backend listens to "action".
      // We'll trust the existing pattern.
      socketRef.current.send(
        JSON.stringify({
          action: 'chat',
          type: 'chat',
          message,
          playerId: userId,
          nickname: nickname || 'Player',
          timestamp: Date.now(),
        }),
      );
    },
    [userId, nickname],
  );

  // Manual connect function
  const connectToLobby = useCallback(() => {
    if (!userId || isConnecting || status === 'connected') return;
    setIsConnecting(true);

      const connect = () => {
        // Clear any stale players/ghosts from a previous connection before the
        // fresh snapshot arrives.
        setPlayers([]);
        setMessages([]);
        recentlyLeftRef.current = {};
        manualDisconnectRef.current = false;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }

      const params = new URLSearchParams();
      if (token) params.set('token', token);
      params.set('userId', userId);
      if (nickname) params.set('nickname', nickname);

      // Color and size are lightweight visual preferences. Image and identity
      // come from the server-authoritative user profile.
      const avatarColor = localStorage.getItem(`avatar_color_${userId}`) || '#4a90e2';
      const avatarSize = localStorage.getItem(`avatar_size_${userId}`) || DEFAULT_AVATAR_SIZE;

      params.set('avatarColor', avatarColor);
      params.set('avatarSize', avatarSize);
      const socket = new WebSocket(`${WEBSOCKET_URL}?${params.toString()}`);
      socketRef.current = socket;
      setStatus('connecting');

      socket.addEventListener('open', () => {
        setStatus('connected');
        setIsConnecting(false);
        // Request snapshot after connection is established
        socket.send(JSON.stringify({ action: 'getSnapshot' }));

      });

      socket.addEventListener('message', (event) => {
        const payload = parseMessage(event);
        lastActivityRef.current = Date.now();

        switch (payload.type) {
          case 'snapshot':
            // Strict replacement: Snapshot is the source of truth. Discard old state.
            // This removes any "ghosts" that aren't in the new snapshot.
            {
              const cleanSnapshot = (payload.players || []).filter(p => p && p.playerId);
              setPlayers(cleanSnapshot);
              const self = cleanSnapshot.find((p) => p?.playerId === userId);
              if (self) {
                setSelfProfile({
                  avatarColor: self.avatarColor || null,
                  avatarImage: self.avatarImage || null,
                  avatarSize: self.avatarSize || DEFAULT_AVATAR_SIZE,
                });
              }
            }
            break;

          case 'playerJoined':
            if (isRecentlyLeft(payload.player?.playerId)) break;
            setPlayers((prev) => upsertPlayers(prev, [payload.player]));
            break;
          case 'playerMoved':
            if (isRecentlyLeft(payload.player?.playerId)) break;
            setPlayers((prev) => upsertPlayers(prev, [payload.player]));
            if (payload.player?.playerId === userId) {
              setSelfProfile({
                avatarColor: payload.player.avatarColor || null,
                avatarImage: payload.player.avatarImage || null,
                avatarSize: payload.player.avatarSize || DEFAULT_AVATAR_SIZE,
              });
            }
            break;
          case 'playerGame':
            if (isRecentlyLeft(payload.player?.playerId)) break;
            setPlayers((prev) => upsertPlayers(prev, [payload.player]));
            break;
          case 'emote': {
            if (isRecentlyLeft(payload.player?.playerId)) break;
            const emoteEntry = {
              id: `${payload.ts}-${Math.random().toString(36).slice(2, 8)}`,
              playerId: payload.player?.playerId,
              nickname: payload.player?.nickname || 'Player',
              emote: payload.emote || '👋',
              ts: payload.ts || Date.now(),
            };
            setEmotes((prev) => [...prev, emoteEntry].slice(-20));
            setTimeout(() => {
              setEmotes((prev) => prev.filter((e) => e.id !== emoteEntry.id));
            }, 3000);
            break;
          }
          case 'playerLeft':
            recentlyLeftRef.current[payload.playerId] = Date.now();
            setPlayers((prev) => prev.filter((p) => p.playerId !== payload.playerId));
            break;

          case 'chat':
            setMessages((prev) => [...prev, payload]);
            break;
        }

        messageListenersRef.current.forEach((cb) => {
          try {
            cb(payload);
          } catch (err) {
            console.error('Lobby message listener error:', err);
          }
        });
      });

      // Heartbeat: keep the connection alive and detect a silently-dead socket
      // (API Gateway drops idle connections; the browser readyState stays OPEN).
      // If nothing (pong, move, chat) arrives for 90s, force-close to trigger
      // the auto-reconnect below.
      lastActivityRef.current = Date.now();
      pingIntervalRef.current = setInterval(() => {
        if (socketRef.current !== socket || socket.readyState !== WebSocket.OPEN) return;
        if (Date.now() - lastActivityRef.current > 90000) {
          socket.close();
          return;
        }
        socket.send(JSON.stringify({ action: 'ping', type: 'ping' }));
      }, 25000);

      const handleClose = () => {
        // Ignore close events from superseded sockets (e.g. after a manual
        // Disconnect + quick Connect), otherwise the stale event flips the
        // fresh connection's status back to 'disconnected'.
        if (socketRef.current !== socket) return;
        if (pingIntervalRef.current) {
          clearInterval(pingIntervalRef.current);
          pingIntervalRef.current = null;
        }
        setStatus('disconnected');
        setIsConnecting(false);
        // Auto-reconnect after an unexpected drop (not a manual Disconnect).
        if (!manualDisconnectRef.current) {
          retryRef.current = setTimeout(() => {
            if (connectToLobbyRef.current) connectToLobbyRef.current();
          }, 3000);
        }
      };

      socket.addEventListener('close', handleClose);

      socket.addEventListener('error', (err) => {
        if (socketRef.current !== socket) return;
        console.error('WebSocket error:', err);
        setStatus('error');
        setIsConnecting(false);
      });
    };

    connect();
  }, [userId, nickname, token, isConnecting, status]);

  // Manual disconnect function
  const disconnectFromLobby = useCallback(() => {
    manualDisconnectRef.current = true;
    if (pingIntervalRef.current) {
      clearInterval(pingIntervalRef.current);
      pingIntervalRef.current = null;
    }
    if (socketRef.current) {
      socketRef.current.close();
      socketRef.current = null;
    }
    if (retryRef.current) {
      clearTimeout(retryRef.current);
      retryRef.current = null;
    }
    setStatus('disconnected');
    setIsConnecting(false);
    setPlayers([]);
    setEmotes([]);
    setMessages([]); // Clear messages on disconnect
    setSelfProfile(null);
    recentlyLeftRef.current = {};
  }, []);

  // Keep a fresh reference to connectToLobby so the auto-reconnect timeout
  // always calls the latest version (with current state deps).
  useEffect(() => {
    connectToLobbyRef.current = connectToLobby;
  }, [connectToLobby]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (pingIntervalRef.current) {
        clearInterval(pingIntervalRef.current);
        pingIntervalRef.current = null;
      }
      if (socketRef.current) {
        socketRef.current.close();
      }
      if (retryRef.current) {
        clearTimeout(retryRef.current);
      }
    };
  }, []);

return {
players,
emotes,
messages,
selfProfile,
status,
sendMove,
sendChat,
sendRaw,
sendGameStatus,
sendEmote,
subscribe,
connectToLobby,
disconnectFromLobby,
isConnecting,
};
}

export default useLobby;
