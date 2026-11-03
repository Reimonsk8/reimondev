import React, { useMemo } from 'react';

export default function MyStatsCard({ transactions = [], stats: backendStats = {} }) {
    const stats = useMemo(() => {
        // If we have backend stats, rely on those (more accurate for lifetime)
        if (backendStats && (backendStats.totalGames > 0 || backendStats.totalWagered > 0)) {
            const games = backendStats.totalGames || 0;
            const wins = backendStats.totalWins || 0;
            const wagered = parseFloat(backendStats.totalWagered || 0);
            const won = parseFloat(backendStats.totalWon || 0);

            return {
                totalBets: games,
                wins,
                losses: games - wins,
                winRate: games > 0 ? Math.round((wins / games) * 100) : 0,
                wagered: wagered.toFixed(2),
                netProfit: (won - wagered).toFixed(2),
                biggestWin: parseFloat(backendStats.biggestWin || 0).toFixed(2)
            };
        }

        // Fallback to calculating from transactions (only accurate for recent history)
        let bets = 0;
        let wins = 0;
        let losses = 0;
        let wagered = 0;
        let netProfit = 0;
        let biggestWin = 0;

        transactions.forEach(t => {
            const amount = Math.abs(parseFloat(t.amount));
            const type = t.type;

            if (type === 'BET') {
                bets++;
                wagered += amount;
                netProfit -= amount; // Cost of bet
            } else if (type === 'WIN') {
                wins++;
                netProfit += amount; // Gross return
                if (amount > biggestWin) biggestWin = amount;
            } else if (type === 'LOSS') {
                losses++;
                // Do not adjust profit here, as BET already deducted the amount.
                // LOSS record is just for history/count.
            }
        });

        const totalGames = bets;
        const winRate = totalGames > 0 ? Math.round((wins / totalGames) * 100) : 0;

        return {
            totalBets: totalGames,
            wins,
            losses,
            winRate,
            wagered: wagered.toFixed(2),
            netProfit: netProfit.toFixed(2),
            biggestWin: biggestWin.toFixed(2)
        };
    }, [transactions, backendStats]);

    const perGame = useMemo(() => {
        const map = {};
        transactions.forEach((t) => {
            const name = t.gameName || 'Unknown';
            map[name] = map[name] || { played: 0, won: 0, wagered: 0, wonAmount: 0 };
            const amount = Math.abs(parseFloat(t.amount) || 0);
            if (t.type === 'BET') {
                map[name].played++;
                map[name].wagered += amount;
            } else if (t.type === 'WIN') {
                map[name].won++;
                map[name].wonAmount += amount;
            }
        });
        return Object.entries(map)
            .map(([name, v]) => ({ ...v, name }))
            .sort((a, b) => b.played - a.played);
    }, [transactions]);

    return (
        <>
        <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(2, 1fr)',
            gap: '16px',
            marginTop: '24px'
        }}>
                {/* Games */}
                <div style={{
                    background: 'linear-gradient(145deg, rgba(255, 255, 255, 0.05), rgba(255, 255, 255, 0.02))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Games
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#fff', fontSize: '32px', fontWeight: '900' }}>
                        {stats.totalBets}
                    </p>
                </div>

                {/* Win Rate */}
                <div style={{
                    background: 'linear-gradient(145deg, rgba(45, 212, 191, 0.12), rgba(45, 212, 191, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(45, 212, 191, 0.2)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#2dd4bf', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Win Rate
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#2dd4bf', fontSize: '32px', fontWeight: '900' }}>
                        {stats.winRate}%
                    </p>
                </div>

                {/* Wins */}
                <div style={{
                    background: 'linear-gradient(145deg, rgba(52, 211, 153, 0.12), rgba(52, 211, 153, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(52, 211, 153, 0.2)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#34d399', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Wins
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#34d399', fontSize: '32px', fontWeight: '900' }}>
                        {stats.wins}
                    </p>
                </div>

                {/* Losses */}
                <div style={{
                    background: 'linear-gradient(145deg, rgba(251, 113, 133, 0.12), rgba(251, 113, 133, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(251, 113, 133, 0.2)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#fb7185', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Losses
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#fb7185', fontSize: '32px', fontWeight: '900' }}>
                        {stats.losses}
                    </p>
                </div>

                {/* Wagered */}
                <div style={{
                    background: 'linear-gradient(145deg, rgba(251, 191, 36, 0.12), rgba(251, 191, 36, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(251, 191, 36, 0.2)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#fbbf24', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Wagered
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#fbbf24', fontSize: '24px', fontWeight: '900' }}>
                        ${stats.wagered}
                    </p>
                </div>

                {/* Profit */}
                <div style={{
                    background: parseFloat(stats.netProfit) >= 0 ? 'linear-gradient(145deg, rgba(52, 211, 153, 0.12), rgba(52, 211, 153, 0.05))' : 'linear-gradient(145deg, rgba(239, 68, 68, 0.12), rgba(239, 68, 68, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: `1px solid ${parseFloat(stats.netProfit) >= 0 ? 'rgba(52, 211, 153, 0.2)' : 'rgba(239, 68, 68, 0.2)'}`,
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#94a3b8', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Profit
                    </p>
                    <p style={{
                        margin: '10px 0 0',
                        color: parseFloat(stats.netProfit) >= 0 ? '#34d399' : '#ef4444',
                        fontSize: '24px',
                        fontWeight: '900'
                    }}>
                        {parseFloat(stats.netProfit) >= 0 ? '+$' : '-$'}{stats.netProfit.replace('-', '')}
                    </p>
                </div>

                {/* Biggest Win */}
                <div style={{
                    gridColumn: 'span 2',
                    background: 'linear-gradient(145deg, rgba(168, 85, 247, 0.12), rgba(168, 85, 247, 0.05))',
                    borderRadius: '20px',
                    padding: '24px 16px',
                    textAlign: 'center',
                    border: '1px solid rgba(168, 85, 247, 0.2)',
                    boxShadow: '0 10px 20px rgba(0, 0, 0, 0.2)'
                }}>
                    <p style={{ margin: 0, color: '#a855f7', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Biggest Win
                    </p>
                    <p style={{ margin: '10px 0 0', color: '#a855f7', fontSize: '32px', fontWeight: '900' }}>
                        ${stats.biggestWin}
                    </p>
                </div>
            </div>
            {perGame.length > 0 && (
                <div style={{ marginTop: '24px' }}>
                    <p style={{ margin: '0 0 12px', color: '#94a3b8', fontSize: '11px', fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.15em' }}>
                        Per-Game Breakdown
                    </p>
                    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
                        {perGame.map((g) => (
                            <div key={g.name} style={{
                                display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px',
                                padding: '10px 12px', borderRadius: '12px',
                                background: 'rgba(255,255,255,0.04)', border: '1px solid rgba(255,255,255,0.08)',
                            }}>
                                <span style={{ fontWeight: '700', fontSize: '13px', color: '#e2e8f0', minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                                    {g.name}
                                </span>
                                <span style={{ fontSize: '12px', color: '#94a3b8', whiteSpace: 'nowrap' }}>
                                    {g.played} played · {g.won} won
                                </span>
                                <span style={{ fontSize: '12px', fontWeight: '700', color: g.wonAmount - g.wagered >= 0 ? '#34d399' : '#f87171', whiteSpace: 'nowrap' }}>
                                    {g.wonAmount - g.wagered >= 0 ? '+' : ''}${(g.wonAmount - g.wagered).toFixed(2)}
                                </span>
                            </div>
                        ))}
                    </div>
                </div>
            )}
        </>
    );
}
