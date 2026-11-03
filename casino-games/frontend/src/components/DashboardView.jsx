import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
const CoinFlip = lazy(() => import('../games/CoinFlip'));
const CardGame = lazy(() => import('../games/CardGame'));
const LuckyWheel = lazy(() => import('../games/LuckyWheel'));
const Slots = lazy(() => import('../games/Slots'));
const Blackjack = lazy(() => import('../games/Blackjack'));
const Roulette = lazy(() => import('../games/Roulette'));
const Dice = lazy(() => import('../games/Dice'));
const CasinoMap = lazy(() => import('./CasinoMap'));
import GlobalChat from './GlobalChat';
import LeaderboardPanel from './LeaderboardPanel';
import ChipStack from './ChipStack';
import CollapsibleCard from './CollapsibleCard';
import Modal from './Modal';
import AvatarCustomizer from './AvatarCustomizer';
import PlayerProfileCard from './PlayerProfileCard';
import { useProgression } from '../hooks/useProgression';
import { SettingsModal, DailyBonusModal, AchievementsCard } from './PlayerMeta';
import CasinoRules from './CasinoRules';
import PianoModal from './PianoModal';
import OnlinePlayersModal from './OnlinePlayersModal';
import { apiCall } from '../utils/api';
import { playPianoNote } from '../utils/pianoAudio';
import ErrorBoundary from './ErrorBoundary';
import FairnessPanel from './FairnessPanel';
import TestnetWallet from './TestnetWallet';
import { User, Dices, Home, Bell, MessageCircle, Settings, Maximize2, Users, Wallet, Gift, Filter, RefreshCw, Globe, CircleDot } from 'lucide-react';


function DashboardContent({
  user,
  userId,
  balance,
  nickname,
  stats = {},
  transactions = [],
  loading,
  updateBalance,
  placeBet,
  onLogout,
  showModal,
  refreshWallet,
  refreshTransactions,
  walletAvatar,
  fairness,
  lastProof,
  lobby = {},
  onDeleteAccount,
  onOpenLibrary,
  initialGameId,
  onInitialGameConsumed,
}) {
  const [activeTab, setActiveTab] = useState('lobby');
  const [activeGameIndex, setActiveGameIndex] = useState(0);
  const [showGameModal, setShowGameModal] = useState(false);
  const [selectedGameId, setSelectedGameId] = useState(null);
  const [showBlackjackMode, setShowBlackjackMode] = useState(false);
  const [blackjackInitialMode, setBlackjackInitialMode] = useState(null);

  // UI State
  const [showHistory, setShowHistory] = useState(true);
  const [showChat, setShowChat] = useState(false);
  const [highscores, setHighscores] = useState({});
  // isMapFullScreen was a toggle that never got wired; keep the read (layout uses
// the is-fullscreen modifier on mobile) as a constant.
  const isMapFullScreen = false;
  const [showUsersModal, setShowUsersModal] = useState(false);
  const [selectedPlayer, setSelectedPlayer] = useState(null); // For player profile interaction
  const [showCasinoRules, setShowCasinoRules] = useState(false); // For casino rules modal
  const [showPiano, setShowPiano] = useState(false); // For the playable grand piano
  const [isMobile, setIsMobile] = useState(false);

  const prog = useProgression(userId, stats, updateBalance);
  const [showSettings, setShowSettings] = useState(false);
  const [showDailyBonus, setShowDailyBonus] = useState(false);

  useEffect(() => {
    const updateIsMobile = () => setIsMobile(window.innerWidth <= 900);
    updateIsMobile();
    window.addEventListener('resize', updateIsMobile);
    window.addEventListener('orientationchange', updateIsMobile);
    return () => {
      window.removeEventListener('resize', updateIsMobile);
      window.removeEventListener('orientationchange', updateIsMobile);
    };
  }, []);

  useEffect(() => {
    if (isMobile) {
      setShowHistory(false);
    } else {
      setShowHistory(true);
    }
  }, [isMobile]);

  // Fetch leaderboard (top winner per game) every 30s; shared by the map plaques
  // and the sidebar LeaderboardPanel.
  useEffect(() => {
    const fetchLeaderboard = async () => {
      try {
        const data = await apiCall('/games/leaderboard');
        setHighscores(data || {});
      } catch (error) {
        console.error('Failed to fetch leaderboard:', error);
      }
    };

    fetchLeaderboard();
    const interval = setInterval(fetchLeaderboard, 30000);
    return () => clearInterval(interval);
  }, []);

  // Auto-connect once when switching to the lobby tab. Without the ref guard
  // this effect re-ran on every render and instantly reconnected after a
  // manual Disconnect (status flips back to 'disconnected' -> re-connect).
  const autoConnectedRef = useRef(false);
  useEffect(() => {
    if (activeTab !== 'lobby') {
      autoConnectedRef.current = false;
      return;
    }
    if (!autoConnectedRef.current && lobby?.connectToLobby && lobby?.status === 'disconnected' && !lobby?.isConnecting) {
      autoConnectedRef.current = true;
      lobby.connectToLobby();
    }
  }, [activeTab, lobby]);



  // Avatar customization state - load from localStorage
  const [avatarColor, setAvatarColor] = useState(() => {
    if (userId) {
      const saved = localStorage.getItem(`avatar_color_${userId}`);
      return saved || '#4a90e2';
    }
    return '#4a90e2';
  });
  const [avatarSize, setAvatarSize] = useState(() => {
    if (userId) {
      const saved = localStorage.getItem(`avatar_size_${userId}`);
      return saved ? Number(saved) : 80;
    }
    return 80;
  });
  const [avatarImage, setAvatarImage] = useState(() => {
    if (userId) {
      return localStorage.getItem(`avatar_image_${userId}`) || null;
    }
    return null;
  });
  // If lobby sends back our own avatar (e.g., from another device), hydrate local state/storage
  useEffect(() => {
    if (!userId || avatarImage) return;
    const selfProfile = lobby?.selfProfile;
    const selfFromLobby = (lobby?.players || []).find((p) => p?.playerId === userId && p.avatarImage);
    const source = (walletAvatar ? { avatarImage: walletAvatar } : null) || (selfProfile?.avatarImage ? selfProfile : selfFromLobby);
    if (source?.avatarImage) {
      setAvatarImage(source.avatarImage);
      localStorage.setItem(`avatar_image_${userId}`, source.avatarImage);
      if (source.avatarColor) {
        localStorage.setItem(`avatar_color_${userId}`, source.avatarColor);
      }
      if (source.avatarSize) {
        localStorage.setItem(`avatar_size_${userId}`, String(source.avatarSize));
      }
    } else if (user?.picture && !localStorage.getItem(`avatar_image_${userId}`)) {
      // Google account picture as default avatar when no custom avatar uploaded
      setAvatarImage(user.picture);
      localStorage.setItem(`avatar_image_${userId}`, user.picture);
    }
  }, [avatarImage, walletAvatar, lobby?.players, lobby?.selfProfile, userId, user?.picture]);

  const games = [
    {
      id: 'coinflip-1',
      name: 'Coin Flip',
      render: (onClose) => (
        <CoinFlip
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'cardgame-1',
      name: 'Card Duel',
      render: (onClose) => (
        <CardGame
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'luckywheel-1',
      name: 'Lucky Wheel',
      render: (onClose) => (
        <LuckyWheel
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'slots-1',
      name: 'Slot Machine',
      render: (onClose) => (
        <Slots
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'blackjack-1',
      name: 'Blackjack',
      render: (onClose) => (
        <Blackjack
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
          isOnline={lobby?.status === 'connected'}
          userId={userId}
          nickname={nickname}
          sendRaw={lobby?.sendRaw}
          subscribe={lobby?.subscribe}
          initialMode={blackjackInitialMode}
        />
      ),
    },
    {
      id: 'roulette-1',
      name: 'Roulette',
      render: (onClose) => (
        <Roulette
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
    {
      id: 'dice-1',
      name: 'Dice',
      render: (onClose) => (
        <Dice
          balance={balance}
          placeBet={placeBet}
          refreshWallet={refreshWallet}
          refreshTransactions={refreshTransactions}
          showModal={showModal}
          onClose={onClose}
        />
      ),
    },
  ];

  const currentGame = games[activeGameIndex];

const lobbyPlayers = lobby?.players || [];
const lobbyStatus = lobby?.status || 'disconnected';
const lobbySendMove = lobby?.sendMove;
const lobbySendGameStatus = lobby?.sendGameStatus;
const lobbySendEmote = lobby?.sendEmote;
const lobbyEmotes = lobby?.emotes || [];
const chatMessages = lobby?.messages || [];
const chatSend = lobby?.sendChat;
const remotePlayers = useMemo(() => {
const deduped = new Map();
lobbyPlayers.forEach((player) => {
// Robust filtering: Exclude self, guests, and missing IDs
if (!player?.playerId || player.playerId === 'guest') return;
if (player.playerId === userId || String(player.playerId) === String(userId)) return;
deduped.set(player.playerId, {
userId: player.playerId,
x: player.position?.x ?? 960,
y: player.position?.y ?? 540,
// Ensure nickname is never undefined/null
nickname: player.nickname || 'Player',
direction: player.direction,
avatarColor: player.avatarColor || '#ff6b6b',
avatarSize: player.avatarSize || 80,
avatarImage: player.avatarImage,
isSmoking: player.isSmoking,
smokeStart: player.position?.smokeStart ?? player.smokeStart ?? null,
seated: player.position?.seated ?? player.seated ?? false,
currentGame: player.currentGame || null,
});
});
return Array.from(deduped.values());
}, [lobbyPlayers, userId]);

// Broadcast presence: which game the local player is currently in
useEffect(() => {
if (!lobbySendGameStatus) return;
const game = selectedGameId
? games.find((g) => g.id === selectedGameId)?.name || 'Blackjack'
: null;
lobbySendGameStatus(game);
}, [selectedGameId, lobbySendGameStatus]);

  const chatMap = useMemo(() => {
    const now = Date.now();
    const lifetime = 6000;
    const map = {};
    chatMessages.forEach((msg) => {
      if (!msg?.playerId || !msg?.message) return;
      if (now - (msg.timestamp || now) > lifetime + 1000) return;
      map[String(msg.playerId)] = { message: msg.message, timestamp: msg.timestamp || now };
    });
    return map;
  }, [chatMessages]);

  const [playerDirectory, setPlayerDirectory] = useState({
    players: [],
    totalPlayers: 0,
    onlinePlayers: 0,
  });
  const [, setDirectoryLoading] = useState(false);

  useEffect(() => {
    if (!userId) return undefined;
    let active = true;
    setDirectoryLoading(true);
    apiCall('/players/status', 'GET', null, true)
      .then((response) => {
        if (!active) return;
        const players = Array.isArray(response.players) ? response.players : [];
        setPlayerDirectory({
          players,
          totalPlayers: response.totalPlayers ?? players.length,
          onlinePlayers: response.onlinePlayers ?? players.filter((player) => player.status === 'online').length,
        });
      })
      .catch(() => {
        if (!active) return;
        setPlayerDirectory({
          players: [],
          totalPlayers: 0,
          onlinePlayers: 0,
        });
      })
      .finally(() => {
        if (active) setDirectoryLoading(false);
      });
    const intervalId = setInterval(() => {
      apiCall('/players/status', 'GET', null, true)
        .then((response) => {
          if (!active) return;
          const players = Array.isArray(response.players) ? response.players : [];
          setPlayerDirectory({
            players,
            totalPlayers: response.totalPlayers ?? players.length,
            onlinePlayers: response.onlinePlayers ?? players.filter((player) => player.status === 'online').length,
          });
        })
        .catch(() => {
          /* ignore periodic errors */
        });
    }, 10000);
    return () => {
      active = false;
      clearInterval(intervalId);
    };
  }, [userId]);

  const GAME_POSITIONS = {
    'Coin Flip': { x: 500, y: 300 },
    'Card Duel': { x: 800, y: 300 },
    'Lucky Wheel': { x: 1100, y: 300 },
  };

  useEffect(() => {
    if (!lobbySendMove || !currentGame) return;
    const position = GAME_POSITIONS[currentGame.name] || { x: 600, y: 300 };
    lobbySendMove({ x: position.x, y: position.y });
  }, [currentGame?.name, lobbySendMove]);

  const openGameModalById = (gameId) => {
    if (gameId === 'blackjack-1') {
      setShowBlackjackMode(true);
      return;
    }
    const gameIndex = games.findIndex((g) => g.id === gameId);
    if (gameIndex !== -1) {
      setActiveGameIndex(gameIndex);
      setSelectedGameId(gameId);
      setShowGameModal(true);
    }
  };

  const chooseBlackjackMode = (initialMode) => {
    setBlackjackInitialMode(initialMode);
    setShowBlackjackMode(false);
    const gameIndex = games.findIndex((g) => g.id === 'blackjack-1');
    setActiveGameIndex(gameIndex);
    setSelectedGameId('blackjack-1');
    setShowGameModal(true);
  };

  // Deep-link support: /casino?game=<id> opens that cabinet once on entry.
  const initialGameOpenedRef = useRef(false);
  useEffect(() => {
    if (initialGameOpenedRef.current) return;
    if (!initialGameId) return;
    initialGameOpenedRef.current = true;
    openGameModalById(initialGameId);
    if (onInitialGameConsumed) onInitialGameConsumed();
  }, [initialGameId, onInitialGameConsumed]);

  const handleTableInteraction = (tableId) => {
    // Handle info desk interaction
    if (tableId === 'info-desk') {
      setShowCasinoRules(true);
      return;
    }

    // Playable grand piano
    if (tableId === 'piano') {
      setShowPiano(true);
      return;
    }

    openGameModalById(tableId);
  };

  // Multiplayer piano: broadcast my notes over the lobby WebSocket and play
  // remote players' notes so everyone in the casino hears the piano.
  const sendPianoNote = (midi) => {
    if (lobby?.status !== 'connected') return;
    lobby.sendRaw({
      action: 'piano',
      type: 'piano',
      midi,
      playerId: userId,
      nickname: nickname || 'Player',
      ts: Date.now(),
    });
  };

  useEffect(() => {
    if (!lobby?.subscribe) return undefined;
    // When the piano modal is closed, still play remote notes so the lobby
    // can "listen in". The modal handles its own subscription when open.
    return lobby.subscribe((msg) => {
      if (msg?.type === 'piano' && typeof msg.midi === 'number' && !showPiano) {
        playPianoNote(msg.midi);
      }
    });
  }, [lobby, showPiano]);

  const handlePlayerInteraction = (player) => {
    setSelectedPlayer(player);
  };

  const closePlayerProfile = () => {
    setSelectedPlayer(null);
  };

  const closeGameModal = () => {
    setShowGameModal(false);
    setSelectedGameId(null);
  };

  const handleWalletAction = async (event, type) => {
    event.preventDefault();
    const amount = parseFloat(event.target.amount.value);

    if (Number.isNaN(amount) || amount <= 0) {
      showModal('Invalid amount', 'Enter a value greater than zero.', 'error');
      return;
    }

    if (type === 'withdraw' && amount > balance) {
      showModal('Insufficient funds', 'Balance does not cover this withdrawal.', 'error');
      return;
    }

    const successMessage = type === 'deposit'
      ? `Deposit of $${amount.toFixed(2)} processed.`
      : `Withdrawal of $${amount.toFixed(2)} processed.`;

    try {
      await updateBalance(amount, type);
      await Promise.all([refreshWallet?.(), refreshTransactions?.()]);
      showModal('Operation successful', successMessage, 'success');
      event.target.reset();
    } catch (err) {
      showModal('Could not process', err.response ? err.response.message : err.message, 'error');
    }
  };

  const toggleFullScreen = () => {
    if (!document.fullscreenElement) {
      document.documentElement.requestFullscreen().catch(err => {
        console.log(`Error attempting to enable full-screen mode: ${err.message} (${err.name})`);
      });
    } else {
      if (document.exitFullscreen) {
        document.exitFullscreen();
      }
    }
  };

  const getTransactionDetails = (tx) => {
    const type = tx.type?.toUpperCase() || 'TRANSACTION';
    const amount = Number(tx.amount) || 0;
    const gameNameRaw = tx.gameName || tx.memo || '';
    const gameNameClean = gameNameRaw.toUpperCase();

    let gameName;
    let status = amount >= 0 ? 'WIN' : 'LOSS';
    let icon = null;
    let iconClass = 'bg-gray-500/20 text-gray-400';

    // SVG Icons
    const Icons = {
      Cards: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="2" y="6" width="14" height="12" rx="2" />
          <path d="M6 12h4" /><path d="M22 6v12a2 2 0 0 1-2 2H8" /><path d="M6 6c0-1.1.9-2 2-2h12a2 2 0 0 1 2 2v12" />
        </svg>
      ),
      Slots: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="14" height="18" rx="2" />
          <path d="M21 12h-4" /><path d="M21 8h-4" /><path d="M21 16h-4" /><circle cx="10" cy="12" r="3" />
        </svg>
      ),
      Dice: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2" />
          <circle cx="8.5" cy="8.5" r="1.5" /><circle cx="15.5" cy="15.5" r="1.5" />
        </svg>
      ),
      Wheel: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 2v20" /><path d="M2 12h20" /><path d="m19.07 4.93-14.14 14.14" /><path d="m4.93 4.93 14.14 14.14" />
        </svg>
      ),
      Coin: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <circle cx="12" cy="12" r="10" /><path d="M12 6v12" /><path d="M17 9H9.5a2.5 2.5 0 0 0 0 5H13a2.5 2.5 0 0 1 0 5H4.5" />
        </svg>
      ),
      Wallet: (
        <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
          <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" /><path d="M4 6v12c0 1.1.9 2 2 2h14v-4" /><path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
        </svg>
      )
    };

    if (type === 'DEPOSIT') {
      gameName = 'DEPOSIT';
      status = 'SUCCESS';
      icon = Icons.Wallet;
      iconClass = 'bg-cyan-500/20 text-cyan-400';
    } else if (type === 'WITHDRAWAL') {
      gameName = 'WITHDRAWAL';
      status = 'PENDING';
      icon = Icons.Coin;
      iconClass = 'bg-rose-500/20 text-rose-400';
    } else if (type === 'BET') {
      gameName = `${gameNameClean} BET`;
      status = 'WAGERED';
      iconClass = 'bg-blue-500/20 text-blue-400';
    } else if (type === 'WIN' || type === 'LOSS') {
      gameName = `${gameNameClean} ${type}`;
      status = type;
      iconClass = type === 'WIN' ? 'bg-emerald-500/20 text-emerald-400' : 'bg-red-500/20 text-red-400';
    } else {
      gameName = gameNameClean || type;
    }

    // Assign Game Icons if not set
    if (!icon) {
      if (gameNameClean.includes('BLACKJACK') || gameNameClean.includes('CARD') || gameNameClean.includes('DUEL')) {
        icon = Icons.Cards;
      } else if (gameNameClean.includes('SLOT')) {
        icon = Icons.Slots;
      } else if (gameNameClean.includes('DICE')) {
        icon = Icons.Dice;
      } else if (gameNameClean.includes('ROULETTE') || gameNameClean.includes('WHEEL')) {
        icon = Icons.Wheel;
      } else {
        icon = Icons.Coin;
      }
    }

    return { gameName, status, icon, iconClass };
  };


  const [historyLimit, setHistoryLimit] = useState(10);
  const [showFilters, setShowFilters] = useState(false);
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchHistory = (newLimit) => {
    refreshTransactions({
      limit: newLimit || historyLimit,
      startDate: startDate || undefined,
      endDate: endDate || undefined
    });
  };

  const recentTransactions = useMemo(() => {
    if (!Array.isArray(transactions)) return [];
    return transactions.slice(0, 5);
  }, [transactions]);

  const formatAmount = (value) => {
    const num = Number(value) || 0;
    const prefix = num >= 0 ? '+' : '-';
    return `${prefix}$${Math.abs(num).toFixed(2)}`;
  };

  const formatDate = (item) => {
    const raw = item?.createdAt || item?.timestamp;
    if (!raw) return 'No date';
    const date = new Date(raw);
    return date.toLocaleString();
  };

  const formatShortDate = (item) => {
    const raw = item?.createdAt || item?.timestamp;
    if (!raw) return '';
    const date = new Date(raw);
    const now = new Date();
    const mins = Math.floor((now - date) / 60000);
    if (mins < 1) return 'Just now';
    if (mins < 60) return `${mins}m ago`;
    const hours = Math.floor(mins / 60);
    if (hours < 24) return `${hours}h ago`;
    return date.toLocaleDateString();
  };

  // Notifications feed: synthesized client-side from real data (daily bonus
  // availability, recent wins, online presence). Unread = not yet opened.
  const [showNotifications, setShowNotifications] = useState(false);
  const [readNotifications, setReadNotifications] = useState(() => new Set());

  const notifications = useMemo(() => {
    const list = [];
    if (!prog.dailyClaimed) {
      list.push({ id: 'daily', kind: 'Daily', icon: '🎁', title: 'Daily bonus ready to claim', time: 'Now' });
    }
    (Array.isArray(transactions) ? transactions : []).slice(0, 4).forEach((tx, i) => {
      const amount = Number(tx.amount) || 0;
      if (amount > 0 && (tx.type || '').toUpperCase() !== 'DEPOSIT') {
        list.push({
          id: `win-${i}-${tx.timestamp || tx.id || i}`,
          kind: 'Win',
          icon: '💰',
          title: `${tx.gameName || 'Game'} win ${formatAmount(amount)}`,
          time: formatShortDate(tx),
        });
      }
    });
    if (playerDirectory.onlinePlayers > 0) {
      list.push({ id: 'players', kind: 'Players', icon: '👥', title: `${playerDirectory.onlinePlayers} players online now`, time: 'Live' });
    }
    return list.slice(0, 8);
  }, [transactions, prog.dailyClaimed, playerDirectory.onlinePlayers]);

  const unreadCount = notifications.filter((n) => !readNotifications.has(n.id)).length;

  const openNotifications = () => {
    setShowNotifications((prev) => !prev);
    setReadNotifications((prev) => new Set([...prev, ...notifications.map((n) => n.id)]));
  };

  return (
    <div className="dashboard-container">
      {/* Top Navigation */}
      <div className="tab-navigation">
        {/* Brand */}
        <button
          className="nav-brand"
          onClick={() => setActiveTab('lobby')}
          title="Back to Lobby"
          aria-label="Back to Lobby"
        >
          <span className="nav-brand-mark">♠</span>
          <span className="nav-brand-name">CASINO888</span>
        </button>

        {/* Tabs */}
        <div className="tab-nav-tabs">
          <button
            className="tab-button"
            onClick={() => onOpenLibrary && onOpenLibrary()}
            title="Back to the game library"
          >
            <span className="tab-button-icon"><Home size={16} /></span>
            <span>Library</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'profile' ? 'active' : ''}`}
            onClick={() => setActiveTab('profile')}
          >
            <span className="tab-button-icon"><User size={16} /></span>
            <span>Profile</span>
          </button>
          <button
            className={`tab-button ${activeTab === 'lobby' ? 'active' : ''}`}
            onClick={() => setActiveTab('lobby')}
          >
            <span className="tab-button-icon"><Dices size={16} /></span>
            <span>Lobby</span>
          </button>
        </div>

        {/* Left icon group: wallet, notifications, messages, settings, fullscreen */}
        <div className="tab-nav-left-controls">
          {/* Wallet */}
          <button
            className="nav-icon-btn"
            onClick={() => setActiveTab('profile')}
            title="Wallet"
            aria-label="Open Wallet"
          >
            <span>
              <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M20 12V8H6a2 2 0 0 1-2-2c0-1.1.9-2 2-2h12v4" />
                <path d="M4 6v12c0 1.1.9 2 2 2h14v-4" />
                <path d="M18 12a2 2 0 0 0-2 2c0 1.1.9 2 2 2h4v-4h-4z" />
              </svg>
            </span>
          </button>

          {/* Notifications */}
          <div className="nav-notifications-wrap">
            <button
              className="nav-icon-btn"
              onClick={openNotifications}
              title="Notifications"
              aria-label="Notifications"
            >
              <span><Bell size={18} /></span>
              {unreadCount > 0 && <span className="nav-badge">{unreadCount}</span>}
            </button>
            {showNotifications && (
              <>
                <div className="nav-notifications-backdrop" onClick={() => setShowNotifications(false)} />
                <div className="nav-notifications-dropdown" role="menu">
                  <div className="nav-notifications-header">Notifications</div>
                  {notifications.length === 0 ? (
                    <div className="nav-notifications-empty">You're all caught up.</div>
                  ) : (
                    notifications.map((n) => (
                      <button
                        key={n.id}
                        className="nav-notification-item"
                        onClick={() => {
                          setShowNotifications(false);
                          if (n.kind === 'Daily') setShowDailyBonus(true);
                        }}
                      >
                        <span className="nav-notification-icon">{n.icon}</span>
                        <span className="nav-notification-body">
                          <span className="nav-notification-title">{n.title}</span>
                          <span className="nav-notification-time">{n.time}</span>
                        </span>
                        <span className="nav-notification-dot" aria-hidden="true" />
                      </button>
                    ))
                  )}
                </div>
              </>
            )}
          </div>

          {/* Messages */}
          <button
            className="nav-icon-btn"
            onClick={() => setShowChat(!showChat)}
            title="Chat"
            aria-label="Toggle Chat"
          >
            <span><MessageCircle size={18} /></span>
          </button>

          {/* Settings */}
          <button
            className="nav-icon-btn"
            onClick={() => setShowSettings(true)}
            title="Settings"
            aria-label="Settings"
          >
            <span><Settings size={18} /></span>
          </button>

          {/* Fullscreen */}
          <button
            className="nav-icon-btn"
            onClick={toggleFullScreen}
            title="Fullscreen"
            aria-label="Toggle Fullscreen"
          >
            <span><Maximize2 size={18} /></span>
          </button>
        </div>

        {/* Lobby controls */}
        {activeTab === 'lobby' && (
          <div className="tab-nav-lobby-controls">
            {/* Connection status */}
            <button
              className="nav-icon-btn"
              onClick={() =>
                lobbyStatus === 'connected'
                  ? lobby.disconnectFromLobby()
                  : lobby.connectToLobby()
              }
              disabled={lobby.isConnecting}
              title={
                lobby.isConnecting
                  ? 'Connecting…'
                  : lobbyStatus === 'connected'
                    ? 'Connected · click to disconnect'
                    : 'Disconnected · click to connect'
              }
              aria-label="Lobby connection"
            >
              {lobby.isConnecting ? (
                <span className="nav-conn-spinner"></span>
              ) : (
                <span className={`nav-conn-dot ${lobbyStatus === 'connected' ? 'online' : 'offline'}`}></span>
              )}
            </button>

            {/* Online players */}
            <button
              className="nav-icon-btn"
              onClick={() => setShowUsersModal(!showUsersModal)}
              title="Online players"
              aria-label="View Online Players"
            >
              <span><Users size={18} /></span>
              {playerDirectory.onlinePlayers > 0 && (
                <span className="nav-badge">{playerDirectory.onlinePlayers}</span>
              )}
            </button>

            {/* Info panel */}
            <button
              className="nav-icon-btn"
              onClick={() => setShowHistory(!showHistory)}
              title={showHistory ? 'Hide info panel' : 'Show info panel'}
              aria-label="Toggle Info Panel"
            >
              <span>
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                  <circle cx="12" cy="12" r="10" />
                  <path d="M12 16v-4" />
                  <path d="M12 8h.01" />
                </svg>
              </span>
            </button>
          </div>
        )}

        {/* Player zone */}
        <div className="tab-user-info">
          <ChipStack balance={balance} />
          <span className="tab-balance balance-shimmer" title="Balance"><Wallet size={14} style={{ verticalAlign: 'middle', marginRight: 4 }} />{balance.toFixed(2)}</span>
          <span className="nav-level-chip" title={`Level ${prog.level} · ${prog.xp} XP`}>
            LV {prog.level}
          </span>
          <button
            className="nav-icon-btn"
            onClick={() => setShowDailyBonus(true)}
            title="Daily bonus"
            aria-label="Daily Bonus"
          >
            <span><Gift size={18} /></span>
          </button>
          <button className="nav-logout" onClick={onLogout}>
            Log out
          </button>
        </div>
      </div>


      {/* Profile Tab */}
      {activeTab === 'profile' && (
        <div className="dashboard-grid">
          <section className="glass-card hero-card">
            <div className="hero-info">
              <p className="eyebrow">Welcome</p>
              <h2>Hello, {nickname || 'Player'}</h2>
              <p>
                Manage your funds and review your transaction history.
              </p>
              {loading && <span className="badge">Synchronizing.</span>}
            </div>
            <div className="hero-summary">
              <div>
                <span>Available Balance</span>
                <strong>${balance.toFixed(2)}</strong>
              </div>
              <div>
                <span>Player ID</span>
                <p>{userId ? `${userId.slice(0, 6)}...${userId.slice(-4)}` : 'N/A'}</p>
              </div>
            </div>
            <div className="hero-quick-ops">
              <div className="wallet-forms">
                <form onSubmit={(e) => handleWalletAction(e, 'deposit')} className="wallet-form">
                  <label className="form-label" htmlFor="deposit-amount">Deposit</label>
                  <input name="amount" type="number" step="0.01" min="1" className="form-input" placeholder="Amount" disabled={loading} />
                  <button type="submit" className="primary-button" disabled={loading}>
                    Deposit
                  </button>
                </form>
                <form onSubmit={(e) => handleWalletAction(e, 'withdraw')} className="wallet-form">
                  <label className="form-label" htmlFor="withdraw-amount">Withdraw</label>
                  <input name="amount" type="number" step="0.01" min="1" className="form-input" placeholder="Amount" disabled={loading} />
                  <button type="submit" className="secondary-button" disabled={loading}>
                    Withdraw
                  </button>
                </form>
              </div>
            </div>
          </section>

          <section className="glass-card avatar-card">
            <AvatarCustomizer
              nickname={nickname}
              userId={userId}
              email={user?.email}
              avatarColor={avatarColor}
              setAvatarColor={setAvatarColor}
              avatarSize={avatarSize}
              setAvatarSize={setAvatarSize}
              avatarImage={avatarImage}
              setAvatarImage={setAvatarImage}
              loading={loading}
              onSaved={refreshWallet}
            />
          </section>

          <AchievementsCard achievements={prog.achievements} unlockedCount={prog.unlockedCount} stats={stats} transactions={transactions} />

          <FairnessPanel fairness={fairness} lastProof={lastProof} />
          <TestnetWallet />

          <section className="glass-card timeline-card">
            <div className="card-header" style={{ marginBottom: '1.5rem' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', width: '100%' }}>
                <div>
                  <p className="eyebrow">Recent Activity</p>
                  <h3>Latest Movements</h3>
                </div>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <button
                    onClick={() => setShowFilters(!showFilters)}
                    className="ghost-button-small"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                  >
                    <Filter size={12} /> Filters
                  </button>
                  <button
                    onClick={() => fetchHistory()}
                    className="ghost-button-small"
                    style={{ fontSize: '11px', padding: '4px 10px' }}
                  >
                    <RefreshCw size={12} /> Refresh
                  </button>
                </div>
              </div>
            </div>

            {showFilters && (
              <div className="glass-panel" style={{ padding: '15px', marginBottom: '20px', background: 'rgba(0,0,0,0.2)', border: '1px solid rgba(255,255,255,0.05)' }}>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: '15px' }}>
                  <div className="wallet-form">
                    <label className="form-label" style={{ fontSize: '11px' }}>Entry Limit</label>
                    <select
                      value={historyLimit}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        setHistoryLimit(val);
                        fetchHistory(val);
                      }}
                      className="form-input"
                      style={{ padding: '6px 10px', width: '100%' }}
                    >
                      <option value={10}>Top 10</option>
                      <option value={25}>Top 25</option>
                      <option value={50}>Top 50</option>
                    </select>
                  </div>
                  <div className="wallet-form">
                    <label className="form-label" style={{ fontSize: '11px' }}>Start Date</label>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => setStartDate(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 10px', width: '100%' }}
                    />
                  </div>
                  <div className="wallet-form">
                    <label className="form-label" style={{ fontSize: '11px' }}>End Date</label>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => setEndDate(e.target.value)}
                      className="form-input"
                      style={{ padding: '6px 10px', width: '100%' }}
                    />
                  </div>
                  <div className="wallet-form" style={{ display: 'flex', alignItems: 'flex-end' }}>
                    <button
                      onClick={() => fetchHistory()}
                      className="secondary-button"
                      style={{ padding: '10px', fontSize: '11px', width: '100%', height: '38px' }}
                    >
                      Apply Date Filter
                    </button>
                  </div>
                </div>
              </div>
            )}

            {transactions.length === 0 ? (
              <p className="empty-state">No transactions registered yet.</p>
            ) : (
              <ul className="activity-list">
                {transactions.slice(0, historyLimit).map((tx, index) => {
                  const { gameName, status, icon, iconClass } = getTransactionDetails(tx);
                  return (
                    <li key={`${tx.id || tx.timestamp || index}`} className="activity-item">
                      <div className={`activity-icon ${iconClass}`}>
                        {icon}
                      </div>
                      <div className="activity-info">
                        <div className="activity-main">
                          <span className="activity-game">{gameName}</span>
                          <span className={`activity-amount ${tx.amount >= 0 ? 'text-positive' : 'text-negative'}`}>
                            {formatAmount(tx.amount)}
                          </span>
                        </div>
                        <div className="activity-sub">
                          <span className="activity-status">{status}</span>
                          <span className="activity-date">{formatDate(tx)}</span>
                        </div>
                      </div>
                    </li>
                  );
                })}
              </ul>
            )}
          </section>
        </div>
      )}

      {/* Lobby Tab */}
      {activeTab === 'lobby' && (
        <div className={`lobby-container ${isMobile ? 'is-mobile' : ''}`}>

          {/* Main Content Area (Map + Sidebar) */}
          <div className={`lobby-content ${isMobile ? 'is-mobile' : ''}`}>

            {/* Map Wrapper */}
            <div className={`lobby-map-wrapper ${isMobile ? 'is-mobile' : ''} ${isMapFullScreen ? 'is-fullscreen' : ''}`}>

              <div style={{ width: '100%', height: '100%' }}>
            <Suspense fallback={<div className="game-loading">Loading lobby...</div>}>
            <CasinoMap
              userId={userId}
              nickname={nickname}
              onTableInteraction={handleTableInteraction}
              onPlayerInteraction={handlePlayerInteraction}
              avatarColor={avatarColor}
              avatarSize={avatarSize}
              avatarImage={avatarImage}
              remotePlayers={remotePlayers}
              sendMove={lobbySendMove}
              chatMessages={chatMap}
              sendChat={chatSend}
              emotes={lobbyEmotes}
              sendEmote={lobbySendEmote}
              localCurrentGame={selectedGameId ? (games.find((g) => g.id === selectedGameId)?.name || 'Blackjack') : null}
              paused={showGameModal || showBlackjackMode || showUsersModal || Boolean(selectedPlayer) || showCasinoRules || showPiano || showSettings || showDailyBonus}
              level={prog.level}
              highscores={highscores}
              onToggleChat={() => {
                if (lobbyStatus === 'connected') {
                  setShowChat((prev) => !prev);
                }
              }}
            />
            </Suspense>
              </div>

              {/* Mobile Quick Play bar (avoid map movement) */}
              {isMobile && (
                <div className="mobile-quick-play">
                  {games.map((game) => (
                    <button
                      key={game.id}
                      className="primary-button quick-play-btn"
                      onClick={() => openGameModalById(game.id)}
                    >
                      {game.name}
                    </button>
                  ))}
                </div>
              )}

              {/* Map Overlay Controls */}
              <div className="map-overlay-controls">
                {/* Toggle History Button REMOVED - Moved to Top Bar */}


              </div>

            </div>

            {/* Info Sidebar - collapses to 0 width (not rendered) when hidden; contains
                collapsible rows: Recent Bets, Top Winners, Friends. */}
            {!isMapFullScreen && showHistory && (
              <div className={`lobby-sidebar ${isMobile ? 'is-mobile' : ''}`}>
                <div className="lobby-info-panel">
                  <CollapsibleCard eyebrow="History" title="Recent Bets">
                    {recentTransactions.length === 0 ? (
                      <p className="empty-state lobby-history-empty">
                        No bets registered yet.
                      </p>
                    ) : (
                      <ul className="activity-list compact">
                        {recentTransactions.map((tx, index) => {
                          const { gameName, status, icon, iconClass } = getTransactionDetails(tx);
                          const isWin = (tx.amount || 0) >= 0;
                          return (
                            <li key={`${tx.id || tx.timestamp || index}`} className={`activity-item compact ${isWin ? 'is-win' : 'is-loss'}`}>
                              <div className={`activity-icon compact ${iconClass}`}>
                                {icon}
                              </div>
                              <div className="activity-info compact">
                                <div className="activity-main">
                                  <span className="activity-game compact">{gameName}</span>
                                  <span className={`activity-amount compact ${isWin ? 'text-positive' : 'text-negative'}`}>
                                    {formatAmount(tx.amount)}
                                  </span>
                                </div>
                                <div className="activity-sub">
                                  <span className={`result-badge ${isWin ? 'is-win' : 'is-loss'}`}>{status}</span>
                                  <span className="activity-date compact">{formatShortDate(tx)}</span>
                                </div>
                              </div>
                            </li>
                          );
                        })}
                      </ul>
                    )}
                  </CollapsibleCard>

                  <CollapsibleCard eyebrow="Leaderboard" title="Top Winners">
                    <LeaderboardPanel highscores={highscores} />
                  </CollapsibleCard>

                  <CollapsibleCard eyebrow="Social" title="Friends">
                    <p className="empty-state lobby-history-empty">
                      Friend list coming soon.
                    </p>
                  </CollapsibleCard>
                </div>
              </div>
            )}

          </div>

          {/* Users Modal */}
          {showUsersModal && (
            <OnlinePlayersModal
              players={playerDirectory.players}
              onlinePlayers={playerDirectory.onlinePlayers}
              onClose={() => setShowUsersModal(false)}
            />
          )}

          {/* Player Profile Card - Shows when interacting with another player */}
          {selectedPlayer && selectedPlayer.userId && (
            <PlayerProfileCard
              playerId={selectedPlayer.userId}
              nickname={selectedPlayer.nickname || 'Player'}
              avatarColor={selectedPlayer.avatarColor}
              onClose={closePlayerProfile}
            />
          )}

          {/* Global Chat Overlay */}
          <GlobalChat
            isOpen={showChat && lobbyStatus === 'connected'}
            onClose={() => setShowChat(false)}
            nickname={nickname || 'Player'}
            messages={chatMessages}
            onSendMessage={chatSend}
          />

          {/* Casino Rules Modal - Shows when interacting with info desk */}
          {showCasinoRules && <CasinoRules onClose={() => setShowCasinoRules(false)} />}

          {/* Piano Modal - playable grand piano (multiplayer: hear + play with others) */}
          {showPiano && <PianoModal onClose={() => setShowPiano(false)} subscribe={lobby?.subscribe} onPlayNote={sendPianoNote} />}

        </div>
      )}

      {/* Game Modal - Opens when player interacts with table */}
      <Modal
        isOpen={showGameModal}
        onClose={closeGameModal}
        title=""
        body=""
        type="info"
        large={true}
        isGame={true}
      >
        <div className="game-stage">
          <ErrorBoundary key={currentGame.name}>
            <Suspense fallback={<div className="game-loading">Loading {currentGame.name}...</div>}>
              {currentGame.render(closeGameModal)}
            </Suspense>
          </ErrorBoundary>
        </div>
      </Modal>

      {/* Blackjack mode picker - shown before entering the game */}
      <Modal isOpen={showBlackjackMode} onClose={() => setShowBlackjackMode(false)} title="Blackjack" body="" type="info">
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          <p style={{ color: '#94a3b8', marginBottom: '6px' }}>
            How do you want to play?
          </p>
          <button
            type="button"
            className={`primary-button ${lobbyStatus === 'connected' ? 'btn-emerald' : 'btn-slate'}`}
            disabled={lobbyStatus !== 'connected'}
            onClick={() => chooseBlackjackMode('solo')}
            style={{ padding: '14px 24px', fontSize: '15px' }}
          >
            <CircleDot size={16} /> Single Player
          </button>
          <button
            type="button"
            className={`primary-button ${lobbyStatus === 'connected' ? 'btn-purple' : 'btn-slate'}`}
            disabled={lobbyStatus !== 'connected'}
            onClick={() => chooseBlackjackMode('multi')}
            style={{ padding: '14px 24px', fontSize: '15px' }}
          >
            <Globe size={16} /> Multiplayer Table
          </button>
          {lobbyStatus !== 'connected' && (
            <p style={{ color: '#fbbf24', fontSize: '13px', marginTop: '4px' }}>
              Blackjack needs the online lobby — connect first, then reopen this table.
            </p>
          )}
        </div>
      </Modal>

      <SettingsModal
        isOpen={showSettings}
        onClose={() => setShowSettings(false)}
        sound={prog.sound}
        setSound={prog.setSound}
        user={user}
        avatarImage={avatarImage}
        onDeleteAccount={onDeleteAccount}
      />
      <DailyBonusModal
        isOpen={showDailyBonus}
        onClose={() => setShowDailyBonus(false)}
        dailyClaimed={prog.dailyClaimed}
        dailyAmount={prog.dailyAmount}
        claimDaily={prog.claimDaily}
      />

      {/* In-game chat toggle - the game modal covers the lobby nav, so give
          players a floating button to open/close chat while a game is open */}
      {showGameModal && lobbyStatus === 'connected' && (
        <button
          type="button"
          className="ghost-button-small chat-float-btn"
          onClick={() => setShowChat((prev) => !prev)}
          title="Toggle Chat"
          aria-label="Toggle Chat"
        >
          <MessageCircle size={16} />
          <span>{showChat ? 'Close' : 'Chat'}</span>
        </button>
      )}
    </div>
  );
}

export default function DashboardView(props) {
  return (
      <DashboardContent {...props} />
  );
}
