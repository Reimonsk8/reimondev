import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { useWallet } from './hooks/useWallet';
import { useTransactions } from './hooks/useTransactions';
import { useLobby } from './hooks/useLobby';
import AuthView from './components/AuthView';
import DashboardView from './components/DashboardView';
import HomeView from './components/HomeView';
import ArcadeRoute from './components/ArcadeRoute';
import Toasts from './components/Toasts';
import Modal from './components/Modal';
import { OAuthCallback, RequireAuth } from './components/RouteGuards';
import { PLATFORM_MARK, PLATFORM_NAME } from './platform/catalog';
import { soundManager } from './utils/audio';
import { apiCall } from './utils/api';

const SquareOfShadows = lazy(() => import('./games/squareofshadows/SquareOfShadows'));
const Outlands = lazy(() => import('./games/zombie-shooter/ZombieShooter'));

/**
 * Maps the current route to the design-system theme applied on `.casino-bg`.
 * Theme isolation: each game's scoped styles under [data-theme="…"] can only
 * affect its own route, never another game or the neutral platform chrome.
 */
function routeTheme(pathname) {
    if (pathname.startsWith('/casino')) return 'casino';
    if (pathname.startsWith('/square-of-shadows') || pathname.startsWith('/SquareofShadows') || pathname.startsWith('/squareofshadows')) return 'sos';
    if (pathname.startsWith('/outlands') || pathname.startsWith('/zombie-shooter')) return 'outlands';
    if (pathname.startsWith('/arcade')) return 'arcade';
    return 'platform';
}

function App() {
    const navigate = useNavigate();
    const location = useLocation();
    const theme = routeTheme(location.pathname);
    const [searchParams] = useSearchParams();
    const [modal, setModal] = useState({ isOpen: false, title: '', body: '', type: 'info' });

    const { user, setUser, userId, setUserId, isAuthReady } = useAuth();
    const { balance, nickname, stats, loading: walletLoading, updateBalance, placeBet, refreshWallet, avatarImage, fairness, lastProof } = useWallet(userId);
    const { transactions, loading: transactionsLoading, refreshTransactions } = useTransactions(userId);
    const lobby = useLobby(userId, nickname);

    useEffect(() => {
        const setAppHeight = () => {
            const vh = typeof window !== 'undefined' && window.visualViewport ? window.visualViewport.height : window.innerHeight;
            document.documentElement.style.setProperty('--app-height', `${vh}px`);
            document.documentElement.style.setProperty('--app-dvh', `${vh}px`);
        };
        setAppHeight();
        const vv = window.visualViewport;
        if (vv) {
            vv.addEventListener('resize', setAppHeight);
            vv.addEventListener('scroll', setAppHeight);
        }
        window.addEventListener('resize', setAppHeight);
        window.addEventListener('orientationchange', setAppHeight);
        return () => {
            if (vv) {
                vv.removeEventListener('resize', setAppHeight);
                vv.removeEventListener('scroll', setAppHeight);
            }
            window.removeEventListener('resize', setAppHeight);
            window.removeEventListener('orientationchange', setAppHeight);
        };
    }, []);

    // Optimisation: the realtime lobby WebSocket is only needed on the routes
    // that actually use it. Disconnect it elsewhere so leaving a game releases
    // the connection instead of holding it for the whole session. `/casino`
    // drives the floor map and `/square-of-shadows` drives online duels, so
    // both must stay connected; DashboardView reconnects on mount.
    const needsLobby = theme === 'casino' || theme === 'sos' || theme === 'outlands';
    const disconnectLobby = lobby.disconnectFromLobby;
    useEffect(() => {
        if (needsLobby) return;
        disconnectLobby?.();
    }, [needsLobby, disconnectLobby]);

    // Square of Shadows and Outlands have no DashboardView of their own to open
    // the socket, so App owns that connection here.
    const connectLobby = lobby.connectToLobby;
    useEffect(() => {
        if (theme !== 'sos' && theme !== 'outlands') return undefined;
        if (lobby?.status === 'disconnected' && !lobby?.isConnecting) connectLobby?.();
        return undefined;
    }, [theme, lobby?.status, lobby?.isConnecting, connectLobby]);

    const showModal = useCallback((title, body, type = 'info') => {
        setModal({ isOpen: true, title, body, type });
    }, []);

    const closeModal = () => setModal((prev) => ({ ...prev, isOpen: false }));

    // Intended deep-link stashed by RequireAuth (survives the Google OAuth round trip).
    const consumeRedirect = useCallback(() => {
        const target = sessionStorage.getItem('c888_redirect');
        if (target) sessionStorage.removeItem('c888_redirect');
        return target || '/';
    }, []);

    const handleLoginSuccess = () => {
        const idToken = localStorage.getItem('c888_id_token');
        if (idToken) {
            try {
                const payload = JSON.parse(atob(idToken.split('.')[1]));
                setUserId(payload.sub);
            } catch (err) {
                console.error('Failed to parse token on login:', err);
            }
        }
        navigate(consumeRedirect(), { replace: true });
    };

    const clearSession = () => {
        localStorage.removeItem('c888_access_token');
        localStorage.removeItem('c888_id_token');
        localStorage.removeItem('c888_refresh_token');
        localStorage.removeItem('c888_user_id');
    };

    const handleLogout = () => {
        lobby.disconnectFromLobby();
        clearSession();
        setUser({ email: '', sub: '', nickname: 'Player' });
        setUserId(null);
        navigate('/', { replace: true });
        showModal('Session Closed', 'You have logged out successfully.', 'info');
    };

    const handleDeleteAccount = async () => {
        lobby.disconnectFromLobby();
        await apiCall('/auth/delete-account', 'POST', {}, true);
        clearSession();
        setUser({ email: '', sub: '', nickname: 'Player' });
        setUserId(null);
        navigate('/', { replace: true });
        showModal('Account Deleted', 'Your account and all data have been permanently removed.', 'success');
    };

    // The casino-room pad is tied to the casino, not to the session. It used to
    // start on the first click anywhere, so the game-select screen had music
    // playing over it and it followed you into every other world.
    useEffect(() => {
        soundManager.setAmbient(location.pathname.startsWith('/casino'));
    }, [location.pathname]);

    if (!isAuthReady) {
        return (
            <div className="casino-bg" data-theme="platform">
                <div className="casino-grid" />
                <div className="app-shell">
                    <div className="app-loading">
                        <span className="app-loading-mark">{PLATFORM_MARK}</span>
                        <p className="text-2xl font-semibold" style={{ margin: 0 }}>Loading {PLATFORM_NAME}…</p>
                        <p className="text-gray-400" style={{ margin: 0 }}>Preparing your game library.</p>
                    </div>
                </div>
            </div>
        );
    }

    const initialGameId = searchParams.get('game');
    // Square of Shadows invite links: /square-of-shadows?room=ABC234
    const sosRoomCode = searchParams.get('room');

    return (
        <div className="casino-bg" data-theme={theme}>
            <div className="casino-grid" />
            <Routes>
                <Route path="/oauth2/callback" element={<OAuthCallback showModal={showModal} />} />

                <Route
                    path="/"
                    element={
                        userId ? (
                            <main className="app-shell dashboard-mode">
                                <HomeView
                                    userId={userId}
                                    nickname={nickname}
                                    balance={balance}
                                    stats={stats}
                                    email={user?.email}
                                    avatarImage={avatarImage}
                                    onProfileSaved={refreshWallet}
                                    onLogout={handleLogout}
                                />
                            </main>
                        ) : (
                            <main className="app-shell">
                                <AuthView
                                    onLoginSuccess={handleLoginSuccess}
                                    setUser={setUser}
                                    showModal={showModal}
                                />
                            </main>
                        )
                    }
                />

                <Route
                    path="/casino"
                    element={
                        <RequireAuth userId={userId}>
                            <main className="app-shell dashboard-mode">
                                <DashboardView
                                    user={user}
                                    userId={userId}
                                    balance={balance}
                                    nickname={nickname}
                                    stats={stats}
                                    transactions={transactions}
                                    loading={walletLoading || transactionsLoading}
                                    updateBalance={updateBalance}
                                    placeBet={placeBet}
                                    onLogout={handleLogout}
                                    showModal={showModal}
                                    refreshWallet={refreshWallet}
                                    refreshTransactions={refreshTransactions}
                                    walletAvatar={avatarImage}
                                    fairness={fairness}
                                    lastProof={lastProof}
                                    lobby={lobby}
                                    onDeleteAccount={handleDeleteAccount}
                                    onOpenLibrary={() => navigate('/')}
                                    initialGameId={initialGameId}
                                    onInitialGameConsumed={() => navigate('/casino', { replace: true })}
                                />
                            </main>
                        </RequireAuth>
                    }
                />

                <Route
                    path="/arcade"
                    element={
                        <RequireAuth userId={userId}>
                            <main className="app-shell dashboard-mode">
                                <ArcadeRoute
                                    userId={userId}
                                    nickname={nickname}
                                    balance={balance}
                                    stats={stats}
                                    transactions={transactions}
                                    updateBalance={updateBalance}
                                    onLogout={handleLogout}
                                />
                            </main>
                        </RequireAuth>
                    }
                />

                <Route
                    path="/square-of-shadows"
                    element={
                        <RequireAuth userId={userId}>
                            <main className="app-shell game-fullbleed">
                                <Suspense fallback={<div className="game-loading">Entering the shadows…</div>}>
                                    <SquareOfShadows
                                        userId={userId}
                                        nickname={nickname}
                                        avatarImage={avatarImage}
                                        isOnline={lobby?.status === 'connected'}
                                        sendRaw={lobby?.sendRaw}
                                        subscribe={lobby?.subscribe}
                                        initialRoom={sosRoomCode}
                                    />
                                </Suspense>
                            </main>
                        </RequireAuth>
                    }
                />

                <Route
                    path="/outlands"
                    element={
                        <RequireAuth userId={userId}>
                            <main className="app-shell game-fullbleed outlands-route">
                                <Suspense fallback={<div className="game-loading">Entering the Outlands…</div>}>
                                    <Outlands
                                        userId={userId}
                                        nickname={nickname}
                                        avatarImage={avatarImage}
                                        lobby={lobby}
                                    />
                                </Suspense>
                            </main>
                        </RequireAuth>
                    }
                />

                {/* Backward-compatible aliases for the original Square of Shadows URL. */}
                <Route path="/SquareofShadows" element={<Navigate to="/square-of-shadows" replace />} />
                <Route path="/squareofshadows" element={<Navigate to="/square-of-shadows" replace />} />
                <Route path="/zombie-shooter" element={<Navigate to="/outlands" replace />} />
                <Route path="*" element={<Navigate to="/" replace />} />
            </Routes>

            <Modal
                isOpen={modal.isOpen}
                onClose={closeModal}
                title={modal.title}
                body={modal.body}
                type={modal.type}
            />
            <Toasts />
        </div>
    );
}

export default App;
