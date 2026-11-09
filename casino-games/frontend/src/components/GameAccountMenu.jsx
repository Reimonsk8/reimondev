export default function GameAccountMenu({
    nickname,
    isAuthenticated,
    onLogin,
    onLogout,
    compact = false,
}) {
    const initial = (nickname || 'Player').trim().charAt(0).toUpperCase() || 'P';

    return (
        <details className={`game-account-menu${compact ? ' game-account-menu--compact' : ''}`}>
            <summary aria-label={isAuthenticated ? `Player profile for ${nickname || 'Player'}` : 'Open player profile and sign in'}>
                {initial}
            </summary>
            <div className="game-account-popover">
                <span className="game-account-name">{isAuthenticated ? nickname || 'Player' : 'Guest player'}</span>
                <a href="/projects#games">Back to main site</a>
                {isAuthenticated
                    ? <button type="button" onClick={onLogout}>Sign out</button>
                    : <button type="button" onClick={onLogin}>Sign in for online play</button>}
            </div>
        </details>
    );
}
