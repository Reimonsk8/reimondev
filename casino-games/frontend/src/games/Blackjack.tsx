import { useEffect, useState, useRef } from 'react';
import GameShell from '../components/GameShell';
import BetControl from '../components/BetControl';
import { publicAsset } from '../utils/publicAsset';



type ModalType = 'info' | 'success' | 'error';

interface GameProps {
    balance: number;
    placeBet: (amount: number, side: string) => Promise<any>;
    showModal: (title: string, body: string, type?: ModalType) => void;
    refreshWallet?: () => Promise<void>;
    refreshTransactions?: () => Promise<void>;
    onClose?: () => void;
    isOnline?: boolean;
    userId?: string;
    nickname?: string;
    sendRaw?: (payload: any) => void;
    subscribe?: (cb: (msg: any) => void) => () => void;
    initialMode?: 'select' | 'solo' | 'multi';
}

interface Card {
    suit: string;
    rank: string;
    value: number;
}

const calculateHandValue = (cards: Card[]): number => {
    if (!cards || cards.length === 0) return 0;

    let value = 0;
    let aces = 0;

    for (const card of cards) {
        if (card.rank === 'A') {
            aces++;
            value += 11;
        } else {
            value += ['J', 'Q', 'K'].includes(card.rank) ? 10 : parseInt(card.rank, 10);
        }
    }

    while (value > 21 && aces > 0) {
        value -= 10;
        aces--;
    }

    return value;
};

export default function Blackjack({ showModal, refreshWallet, refreshTransactions, onClose, isOnline = false, userId = '', nickname: _nickname = 'Player', sendRaw, subscribe, initialMode }: GameProps) {
    const [betAmount, setBetAmount] = useState(10);

    // ---- Multiplayer state ----
    const [mode, setMode] = useState<'select' | 'solo' | 'multi'>(initialMode || 'select');
    const [bjRoom, setBjRoom] = useState<any>(null);
    const lastPhaseRef = useRef('');

    const selfSeat = bjRoom?.seats?.find((s: any) => s.playerId === userId) || null;
    const readyCount = bjRoom?.seats?.filter((s: any) => s.ready && s.status !== 'left').length || 0;

    const bjSend = (action: string, extra: any = {}) => sendRaw?.({ action, ...extra });

const [tableChat, setTableChat] = useState<Array<{ playerId: string; nickname: string; avatarColor: string; message: string; ts: number }>>([]);
const [chatDraft, setChatDraft] = useState('');
const tableChatRef = useRef<HTMLDivElement | null>(null);
useEffect(() => {
if (tableChatRef.current) tableChatRef.current.scrollTop = tableChatRef.current.scrollHeight;
}, [tableChat]);
const sendTableChat = () => {
const text = chatDraft.trim();
if (!text) return;
bjSend('bj:chat', { message: text });
setChatDraft('');
};
const isSpectator = mode !== 'select' && !!bjRoom && !selfSeat && !!bjRoom?.seats?.length;

    const enterMultiplayer = () => {
        if (!isOnline) {
            showModal('Online Lobby Required', 'Connect to the online lobby to play multiplayer.', 'error');
            return;
        }
        setMode('multi');
    };

    const enterSolo = () => {
        if (!isOnline) {
            showModal('Online Lobby Required', 'Connect to the online lobby to play solo blackjack.', 'error');
            return;
        }
        setMode('solo');
    };

    useEffect(() => {
        if (mode === 'select' || !subscribe) return;
    const unsub = subscribe((msg: any) => {
      if (msg.type === 'bj:state') setBjRoom(msg.room);
      if (msg.type === 'bj:chat') {
        setTableChat((prev) => [...prev, { playerId: msg.player?.playerId, nickname: msg.player?.nickname, avatarColor: msg.player?.avatarColor, message: msg.message, ts: msg.ts }].slice(-50));
      }
      if (msg.type === 'bj:error') showModal('Blackjack', msg.message, 'error');
    });
        return unsub;
    }, [mode, subscribe]);

    useEffect(() => {
        if (mode !== 'select' && isOnline && sendRaw) bjSend('bj:join', { solo: mode === 'solo' });
    }, [mode, isOnline]);

    // Real solo mode: one private seat vs the dealer. Auto-ready + auto-start
    // so no manual Ready/Begin Round ceremony — and after a round ends, clicking
    // Play Again auto-runs the next one too (newRound resets seats to unready).
    const soloStartSentRef = useRef(false);
    useEffect(() => {
        if (mode !== 'solo' || !bjRoom || !selfSeat) return;
        if (bjRoom.phase !== 'queue') { soloStartSentRef.current = false; return; }
        const seedKey = `c888_client_seed_${userId}`;
        let clientSeed = localStorage.getItem(seedKey);
        if (!clientSeed) {
            clientSeed = crypto.randomUUID();
            localStorage.setItem(seedKey, clientSeed);
        }
        if (!selfSeat.ready) {
            soloStartSentRef.current = false;
            bjSend('bj:ready', { bet: betAmount, clientSeed });
        } else if (!soloStartSentRef.current) {
            soloStartSentRef.current = true;
            bjSend('bj:start');
        }
    }, [bjRoom, mode, selfSeat, betAmount]);

    useEffect(() => {
        if (!bjRoom) return;
        const phase = bjRoom.phase;
        if (phase !== lastPhaseRef.current) {
            lastPhaseRef.current = phase;
            if (phase === 'playing' || phase === 'queue') {
                refreshWallet?.();
                refreshTransactions?.();
            }
        }
    }, [bjRoom]);

    const toggleReady = () => {
        if (selfSeat?.ready) bjSend('bj:unready');
        else {
            const key = `c888_client_seed_${userId}`;
            let clientSeed = localStorage.getItem(key);
            if (!clientSeed) {
                clientSeed = crypto.randomUUID();
                localStorage.setItem(key, clientSeed);
            }
            bjSend('bj:ready', { bet: betAmount, clientSeed });
        }
    };

const beginRound = () => bjSend('bj:start');
const hitMulti = () => bjSend('bj:hit');
const standMulti = () => bjSend('bj:stand');
const doubleMulti = () => {
  bjSend('bj:double');
};
const splitMulti = () => {
  bjSend('bj:split');
};
    const playAgain = () => bjSend('bj:newRound');
    const leaveTable = () => {
        bjSend('bj:leave');
        setMode('select');
    };
    const handleClose = () => {
        if (mode !== 'select') bjSend('bj:leave');
        onClose?.();
    };

    const instructions = `Blackjack Rules:
• Get as close to 21 as possible without going over
• Face cards (J, Q, K) are worth 10
• Aces are worth 1 or 11 (automatically adjusted)
• Beat the dealer's hand to win!

Actions:
• HIT: Take another card
• STAND: Keep your current hand
• Dealer must hit on 16 or less, stand on 17+

Payouts:
• Win: 2x your bet
• Blackjack (21 on first 2 cards): 2.5x your bet
• Push (tie): Bet returned`;

    const renderCard = (card: Card, hidden: boolean = false) => (
        <div className={`bj-card ${hidden ? 'bj-card-back' : `bj-card-front ${['♥', '♦'].includes(card.suit) ? 'bj-red' : ''}`}`}>
            {!hidden && (
                <>
                    <div className="bj-card-corner bj-card-corner-tl">
                        <span className="bj-rank">{card.rank}</span>
                        <span className="bj-suit-sm">{card.suit}</span>
                    </div>
                    <span className="bj-card-suit-center">{card.suit}</span>
                    <div className="bj-card-corner bj-card-corner-br">
                        <span className="bj-rank">{card.rank}</span>
                        <span className="bj-suit-sm">{card.suit}</span>
                    </div>
                </>
            )}
        </div>
    );


    return (
        <GameShell
            title="Blackjack"
            subtitle="Beat the dealer to 21!"
            emblem="blackjack"
            instructionsTitle="How to Play Blackjack"
            instructionsBody={instructions}
            onClose={handleClose}
        >
            {mode === 'select' && (
                <div className="game-placeholder bj-mode-select">
                    <h3>Choose a Mode</h3>
                    <div className="bj-mode-options">
                        <button
                            onClick={enterSolo}
                            className={`primary-button ${isOnline ? 'btn-emerald' : 'btn-slate'}`}
                        >
                            Single Player
                        </button>
                        <button
                            onClick={enterMultiplayer}
                            className={`primary-button ${isOnline ? 'btn-purple' : 'btn-slate'}`}
                        >
                            Multiplayer Table
                        </button>
                    </div>
                    <p className="bj-mode-note">
                        Single Player plays 1-vs-dealer in your own private room (auto-starts). Multiplayer joins the live 4-seat table.
                        {!isOnline && ' Connect to the online lobby to play.'}
                    </p>
                </div>
            )}

            {mode !== 'select' && (
                <div className="bj-table-layout">
                    {!bjRoom && (
                        <p style={{ color: '#fbbf24', fontSize: '18px', animation: 'bjPulse 1s infinite' }}>
                            {isOnline ? 'Joining the table...' : 'Offline. Reconnect to the lobby to play multiplayer.'}
                        </p>
                    )}
                    {bjRoom && (
                        <>
                            <div style={{ display: 'flex', justifyContent: 'flex-end', width: '100%', marginBottom: '4px' }}>
                                <button className="ghost-button bj-leave-button" onClick={leaveTable}>Leave Table</button>
                            </div>

                            {/* ── Felt Table ── */}
                            <div className="bj-felt">
                                {/* Generated table-art crest (sprite-gen blackjack atlas) */}
                                <img
                                    src={publicAsset('/sprites/blackjack/sprite-sheet-alpha.png')}
                                    alt=""
                                    aria-hidden="true"
                                    className="bj-felt-crest"
                                    loading="lazy"
                                />
                                {/* Dealer zone */}
                                <div className="bj-felt-dealer">
                                    <div className="bj-hand-label">
                                        DEALER
                                        {bjRoom.dealerHand.length > 0 && (
                                            <span className={`bj-value ${bjRoom.phase !== 'playing' && calculateHandValue(bjRoom.dealerHand) > 21 ? 'bj-value-bust' : 'bj-value-ok'}`}>
                                                {bjRoom.phase === 'dealer' || bjRoom.phase === 'ended'
                                                    ? calculateHandValue(bjRoom.dealerHand)
                                                    : calculateHandValue([bjRoom.dealerHand[0]]) + ' + ?'}
                                            </span>
                                        )}
                                    </div>
                                    <div className="bj-cards" style={{ minHeight: '70px' }}>
                                        {bjRoom.dealerHand.length === 0 && (
                                            <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '12px' }}>Waiting for round...</span>
                                        )}
                                        {bjRoom.dealerHand.map((card: Card, i: number) => (
                                            <div key={i}>{renderCard(card, i === 1 && bjRoom.phase === 'playing')}</div>
                                        ))}
                                    </div>
                                </div>

                                <div className="bj-felt-text">Blackjack pays 3 to 2 &nbsp;·&nbsp; Dealer stands on 17</div>

                                <div className="bj-divider" style={{ width: '80%' }} />

                                {/* Player seats */}
                                <div className="bj-felt-seats">
                                    {[0, 1, 2, 3].map((slotIdx) => {
                                        const seat = bjRoom.seats.find((s: any) => {
                                            const seatIdx = bjRoom.seats.indexOf(s);
                                            return seatIdx === slotIdx;
                                        }) || null;
                                        if (!seat) {
                                            return (
                                                <div key={slotIdx} className="bj-felt-seat bj-felt-seat-empty">
                                                    {!selfSeat ? (
                                                        <button className="bj-felt-seat-join" onClick={() => bjSend('bj:join')}>Take Seat</button>
                                                    ) : (
                                                        <span style={{ color: 'rgba(255,255,255,0.25)', fontSize: '11px' }}>Empty</span>
                                                    )}
                                                </div>
                                            );
                                        }
                                        const isSelf = seat.playerId === userId;
                                        const seatValue = calculateHandValue(seat.hand);
                                        const canAct = seat.status === 'active' && bjRoom.phase === 'playing';
                                        const totalColor = seatValue > 21 ? '#ef4444' : seatValue === 21 ? '#22c55e' : '#fbbf24';
                                        const statusLabel =
                                            seat.result
                                                ? (seat.result === 'win' ? 'Won' : seat.result === 'blackjack' ? 'Blackjack!' : seat.result === 'push' ? 'Push' : 'Lost')
                                                : seat.status === 'active'
                                                    ? (isSelf ? 'Your Turn' : 'Playing')
                                                    : seat.status === 'idle'
                                                        ? (seat.ready ? 'Ready' : 'Waiting')
                                                        : seat.status === 'busted' ? 'Bust'
                                                        : seat.status === 'stood' ? 'Stood' : '';
                                        const statusColor =
                                            seat.result === 'win' || seat.result === 'blackjack' ? '#22c55e'
                                            : seat.result === 'push' ? '#fbbf24'
                                            : seat.result === 'loss' || seat.status === 'busted' ? '#ef4444'
                                            : canAct ? '#fbbf24' : '#94a3b8';

                                        return (
                                            <div key={seat.playerId || slotIdx} className={`bj-felt-seat ${isSelf ? 'bj-felt-seat-self' : ''} ${canAct ? 'bj-felt-seat-active' : ''}`}>
                                                {seat.avatarImage ? (
                                                    <img src={seat.avatarImage} alt="" className="bj-felt-seat-avatar" style={{ borderColor: isSelf ? '#fbbf24' : undefined }} />
                                                ) : (
                                                    <div className="bj-felt-seat-avatar-placeholder" style={{ background: seat.avatarColor || '#4a90e2', borderColor: isSelf ? '#fbbf24' : undefined }}>
                                                        {(seat.nickname || '?').charAt(0).toUpperCase()}
                                                    </div>
                                                )}
                                                <div className="bj-felt-seat-name" style={{ color: isSelf ? '#fbbf24' : '#e2e8f0' }}>
                                                    {isSelf ? `${seat.nickname} (You)` : seat.nickname}
                                                </div>
                                                <div className="bj-felt-seat-bet">${seat.bet}</div>
                                                <div className="bj-felt-seat-cards">
                                                    {seat.hand.length === 0 && <span style={{ color: 'rgba(255,255,255,0.2)', fontSize: '10px' }}>-</span>}
                                                    {seat.hands ? (
                                                        seat.hands.map((h: any, hi: number) => (
                                                            <div key={hi} style={{ display: 'flex', gap: '2px', padding: seat.activeHand === hi && bjRoom.phase === 'playing' ? '2px' : '0', borderRadius: '6px', border: seat.activeHand === hi && bjRoom.phase === 'playing' ? '1px solid rgba(251,191,36,0.5)' : '1px solid transparent' }}>
                                                                {h.cards.map((card: Card, j: number) => <div key={j}>{renderCard(card)}</div>)}
                                                            </div>
                                                        ))
                                                    ) : (
                                                        seat.hand.map((card: Card, j: number) => <div key={j}>{renderCard(card)}</div>)
                                                    )}
                                                </div>
                                                {seat.hand.length > 0 && (
                                                    <div className="bj-felt-seat-value" style={{ background: `${statusColor}18`, border: `1px solid ${statusColor}60`, color: totalColor, animation: canAct ? 'bjPulse 1.2s infinite' : 'none' }}>
                                                        {seatValue}
                                                    </div>
                                                )}
                                                <div className="bj-felt-seat-status" style={{ color: statusColor }}>{statusLabel}</div>
                                                {bjRoom.phase === 'queue' && !isSelf && selfSeat && (
                                                    <button
                                                        className={`bj-kick-button ghost-button ${seat.ready ? 'bj-kick-button-afk' : ''}`}
                                                        style={{ fontSize: '11px', padding: '2px 8px', marginTop: '4px' }}
                                                        onClick={() => bjSend('bj:kick', { playerId: seat.playerId })}
                                                    >
                                                        {seat.afk ? 'Kick (AFK)' : 'Kick'}
                                                    </button>
                                                )}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>

                            {/* ── Queue Controls (below table) ── */}
                            {bjRoom.phase === 'queue' && selfSeat && (
                                <div style={{ width: '100%', maxWidth: '520px' }}>
                                    <BetControl betAmount={betAmount} setBetAmount={setBetAmount} />
                                    <div className="bj-actions">
                                        <button onClick={toggleReady} className={`primary-button ${selfSeat.ready ? 'btn-red' : 'btn-emerald'}`} style={{ minWidth: '140px', fontSize: '15px', padding: '12px 20px' }}>
                                            {selfSeat.ready ? 'Unready' : 'Ready'}
                                        </button>
                                        <button onClick={beginRound} className={`primary-button ${selfSeat.ready && readyCount >= 1 ? 'btn-purple' : 'btn-slate'}`} disabled={!selfSeat.ready || readyCount < 1} style={{ minWidth: '140px', fontSize: '15px', padding: '12px 20px' }}>
                                            Begin Round
                                        </button>
                                    </div>
                                    <p style={{ color: '#94a3b8', fontSize: '13px', textAlign: 'center', marginTop: '6px' }}>
                                        {readyCount} ready · {bjRoom.seats.length}/4 seated
                                    </p>
                                </div>
                            )}

                            {/* ── Playing Controls ── */}
                            {bjRoom.phase === 'playing' && selfSeat && (() => {
                                const active = selfSeat.hands ? selfSeat.hands[selfSeat.activeHand] : selfSeat;
                                const cards = active.cards || active.hand || [];
                                if (active.status !== 'active') return null;
                                const canDouble = cards.length === 2 && !active.doubled && !selfSeat.splitUsed;
                                const canSplit = cards.length === 2 && cards[0].rank === cards[1].rank && !selfSeat.splitUsed;
                                return (
                                    <div className="bj-actions" style={{ width: '100%', maxWidth: '520px' }}>
                                        <button onClick={hitMulti} className="primary-button btn-emerald" style={{ minWidth: '110px', fontSize: '16px', padding: '12px 20px' }}>HIT</button>
                                        <button onClick={standMulti} className="primary-button btn-red" style={{ minWidth: '110px', fontSize: '16px', padding: '12px 20px' }}>STAND</button>
                                        {canDouble && <button onClick={doubleMulti} className="primary-button btn-amber" style={{ minWidth: '110px', fontSize: '16px', padding: '12px 20px' }}>DOUBLE</button>}
                                        {canSplit && <button onClick={splitMulti} className="primary-button btn-purple" style={{ minWidth: '110px', fontSize: '16px', padding: '12px 20px' }}>SPLIT</button>}
                                    </div>
                                );
                            })()}

                            {bjRoom.phase === 'dealer' && (
                                <p style={{ color: '#fbbf24', fontSize: '16px', animation: 'bjPulse 1s infinite' }}>Dealer is drawing...</p>
                            )}

                            {bjRoom.phase === 'ended' && (
                                <div style={{ textAlign: 'center' }}>
                                    {selfSeat?.result && (
                                        <p className={`bj-result ${['win', 'blackjack'].includes(selfSeat.result) ? 'bj-result-win' : selfSeat.result === 'push' ? 'bj-result-push' : 'bj-result-lose'}`}>
                                            {selfSeat.result === 'win' ? 'You Win!' : selfSeat.result === 'blackjack' ? 'BLACKJACK! You Win!' : selfSeat.result === 'push' ? 'Push — Bet Returned' : 'You Lose'}
                                        </p>
                                    )}
                                    <div className="bj-actions">
                                        <button onClick={playAgain} className="primary-button btn-purple" style={{ fontSize: '15px', padding: '12px 24px' }}>Play Again</button>
                                        <button className="ghost-button" onClick={leaveTable} style={{ fontSize: '15px', padding: '12px 24px' }}>Leave Table</button>
                                    </div>
                                </div>
                            )}

                            {/* ── Table Chat ── */}
                            <div className="bj-chat" style={{ width: '100%', maxWidth: '520px' }}>
                                <div className="bj-chat-header">Table Chat {isSpectator ? '· Spectating' : ''}</div>
                                <div ref={tableChatRef} className="bj-chat-messages custom-scrollbar">
                                    {tableChat.length === 0 && <div style={{ color: '#64748b' }}>Say hi to the table!</div>}
                                    {tableChat.map((m, i) => (
                                        <div key={i} style={{ color: '#cbd5e1', wordBreak: 'break-word' }}>
                                            <span style={{ color: m.avatarColor || '#4a90e2', fontWeight: 'bold' }}>{m.nickname}:</span> {m.message}
                                        </div>
                                    ))}
                                </div>
                                <div className="bj-chat-input-row">
                                    <input
                                        value={chatDraft}
                                        onChange={(e) => setChatDraft(e.target.value)}
                                        onKeyDown={(e) => { if (e.key === 'Enter') sendTableChat(); }}
                                        placeholder="Message the table..."
                                        maxLength={200}
                                        className="bj-chat-input"
                                    />
                                    <button onClick={sendTableChat} className="primary-button btn-amber bj-chat-send">Send</button>
                                </div>
                            </div>
                        </>
                    )}
                </div>
            )}

        </GameShell>
    );
}
