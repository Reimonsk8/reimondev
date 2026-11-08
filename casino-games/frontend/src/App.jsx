import { Suspense, lazy, useCallback, useEffect, useState } from 'react';
import { Navigate, Route, Routes, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { useAuth } from './hooks/useAuth';
import { usePlayerProfile } from './hooks/usePlayerProfile';
import { useLobby } from './hooks/useLobby';
import AuthView from './components/AuthView';
import Modal from './components/Modal';
import { OAuthCallback, RequireAuth } from './components/RouteGuards';
import { PLATFORM_MARK, PLATFORM_NAME } from './platform/catalog';

const SquareOfShadows = lazy(() => import('./games/squareofshadows/SquareOfShadows'));
const Outlands = lazy(() => import('./games/zombie-shooter/ZombieShooter'));

/**
 * Maps the current route to the design-system theme applied on `.game-app-bg`.
 * Theme isolation: each game's scoped styles under [data-theme="…"] can only
 * affect its own route, never another game or the neutral platform chrome.
 */
function routeTheme(pathname) {
    if (pathname.startsWith('/square-of-shadows') || pathname.startsWith('/SquareofShadows') || pathname.startsWith('/squareofshadows')) return 'sos';
    if (pathname.startsWith('/outlands') || pathname.startsWith('/zombie-shooter')) return 'outlands';
    return 'platform';
}

function WorkRedirect() {
    useEffect(() => {
        window.location.replace('/projects#games');
    }, []);

    return (
        <main className="app-shell" aria-label="Opening the unified work page">
            <p role="status">Opening the games collection…</p>
            <a href="/projects#games">Continue to Work</a>
        </main>
    );
}

function GameAccountMenu({ nickname, onLogout }) {
    const initial = (nickname || 'Player').trim().charAt(0).toUpperCase() || 'P';
    return (
        <details className="game-account-menu">
            <summary aria-label={`Account menu for ${nickname || 'Player'}`}>{initial}</summary>
            <div className="game-account-popover">
                <span className="game-account-name">{nickname || 'Player'}</span>
                <a href="/projects#games">Back to Work</a>
                <button type="button" onClick={onLogout}>Sign out</button>
            </div>
        </details>
    );
}

function App() {
    const navigate = useNavigate();
    const location = useLocation();
    const theme = routeTheme(location.pathname);
    const [searchParams] = useSearchParams();
    const [modal, setModal] = useState({ isOpen: false, title: '', body: '', type: 'info' });

    const { user, setUser, userId, setUserId, isAuthReady } = useAuth();
    const { nickname, avatarImage } = usePlayerProfile(userId, user);
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

    // The two retained worlds use the shared game socket for their online play.
    const needsLobby = theme === 'sos' || theme === 'outlands';
    const disconnectLobby = lobby.disconnectFromLobby;
    useEffect(() => {
        if (needsLobby) return;
        disconnectLobby?.();
    }, [needsLobby, disconnectLobby]);

    // App owns the socket for the duration of an online-capable game route.
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
        window.location.assign('/projects');
    };

    if (!isAuthReady) {
        return (
            <div className="game-app-bg" data-theme="platform">
                <div className="game-grid" />
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

    // Square of Shadows invite links: /square-of-shadows?room=ABC234
    const sosRoomCode = searchParams.get('room');

    return (
        <div className="game-app-bg" data-theme={theme}>
            <div className="game-grid" />
            {userId && needsLobby && <GameAccountMenu nickname={nickname} onLogout={handleLogout} />}
            <Routes>
                <Route path="/oauth2/callback" element={<OAuthCallback showModal={showModal} />} />

                <Route path="/" element={<WorkRedirect />} />

                <Route
                    path="/login"
                    element={userId ? <Navigate to="/" replace /> : (
                        <main className="app-shell">
                            <AuthView
                                onLoginSuccess={handleLoginSuccess}
                                setUser={setUser}
                                showModal={showModal}
                            />
                        </main>
                    )}
                />

                <Route path="/library" element={<Navigate to="/" replace />} />
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
        </div>
    );
}

export default App;
