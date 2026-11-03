import { useState } from 'react';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash, spinSound } from '../utils/fx';
import BetControl from '../components/BetControl';
import { DieSprite } from '../components/GameArt';

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
    balance: number;
    placeBet: (amount: number, side: string) => Promise<any>;
    showModal: (title: string, body: string, type?: ModalType) => void;
    refreshWallet?: () => Promise<void>;
    refreshTransactions?: () => Promise<void>;
    onClose?: () => void;
}

type BetType = 'high' | 'low' | 'exact' | 'odd' | 'even';

export default function Dice({ balance, placeBet, showModal, refreshTransactions, onClose }: GameProps) {
    const [dice, setDice] = useState<[number, number]>([1, 1]);
    const [rolling, setRolling] = useState(false);
    const [betAmount, setBetAmount] = useState(10);
    const [selectedBet, setSelectedBet] = useState<BetType>('high');
    const [exactTarget, setExactTarget] = useState(7);
    const [resultMessage, setResultMessage] = useState('Roll the dice and win!');
    const [history, setHistory] = useState<string[]>([]);

    const instructions = `🎲 Dice Rules:
Roll two dice (2-12 total)

Bet Types & Payouts:
• High (8-12): 2x
• Low (2-6): 2x  
• Odd Total: 2x
• Even Total: 2x
• Exact Number: 6x (guess the exact total)

7 is the most common roll (6 ways to make it).
2 and 12 are the rarest (only 1 way each).`;

    const rollDice = async () => {
        if (rolling) return;

        if (betAmount <= 0) {
            showModal('Invalid Bet', 'Please enter a bet amount greater than 0.', 'error');
            return;
        }

        if (betAmount > balance) {
            showModal('Insufficient Funds', 'Your bet exceeds your available balance.', 'error');
            return;
        }

            setRolling(true);
            setResultMessage('Rolling...');
            spinSound(1.2);

        // Animate dice rolling
        const rollAnimation = setInterval(() => {
            setDice([
                Math.floor(Math.random() * 6) + 1,
                Math.floor(Math.random() * 6) + 1
            ]);
            playTone(300 + Math.random() * 200, 0.05);
        }, 100);

        try {
            const side = selectedBet === 'exact' ? `exact-${exactTarget}` : selectedBet === 'odd' || selectedBet === 'even' ? `dice-${selectedBet}` : selectedBet;
            const apiResult = await placeBet(betAmount, side);

            // Wait for roll animation
            await new Promise(resolve => setTimeout(resolve, 1500));
            clearInterval(rollAnimation);

            const match = /^(\d)\+(\d)=(\d{1,2})$/.exec(String(apiResult?.result));
            if (!match) throw new Error('Invalid dice result from server.');
            const die1 = Number(match[1]);
            const die2 = Number(match[2]);
            const total = Number(match[3]);
            if (die1 < 1 || die1 > 6 || die2 < 1 || die2 > 6 || total !== die1 + die2) throw new Error('Invalid dice result from server.');

            setDice([die1, die2]);
            playTone(500, 0.2);

            await refreshTransactions?.();
            const isWin = Boolean(apiResult?.isWin);
            const winAmount = Number(apiResult?.winAmount) || 0;

            if (isWin) {
                playTone(880, 0.3);
                setTimeout(() => playTone(1100, 0.2), 150);
                celebrate();
                setResultMessage(`🎉 ${die1} + ${die2} = ${total}! You won $${winAmount.toFixed(2)}!`);
                setHistory(prev => [`${die1}+${die2}=${total} - WON $${winAmount.toFixed(2)}`, ...prev].slice(0, 5));
            } else {
                playTone(200, 0.2);
                bustFlash();
                setResultMessage(`${die1} + ${die2} = ${total}. You lose.`);
                setHistory(prev => [`${die1}+${die2}=${total} - LOST $${betAmount.toFixed(2)}`, ...prev].slice(0, 5));
            }

        } catch (err: any) {
            clearInterval(rollAnimation);
            showModal('Roll Failed', err.message || 'Could not complete roll.', 'error');
            playTone(180, 0.15);
        } finally {
            setRolling(false);
        }
    };

    const betOptions: { type: BetType; label: string; desc: string }[] = [
        { type: 'high', label: 'High 8-12', desc: '2x' },
        { type: 'low', label: 'Low 2-6', desc: '2x' },
        { type: 'odd', label: 'Odd total', desc: '2x' },
        { type: 'even', label: 'Even total', desc: '2x' },
    ];

    const total = dice[0] + dice[1];

    return (
        <GameShell
            title="Dice"
            subtitle="Two dice · server-resolved outcomes"
            emblem="dice"
            history={history}
            historyTitle="Recent Rolls"
            instructionsTitle="How to Play Dice"
            instructionsBody={instructions}
            onClose={onClose}
        >
            <div className="game-placeholder dice-game" aria-busy={rolling}>
                {/* Dice Display */}
                <div className="dice-tray" aria-hidden="true">
                    {dice.map((die, i) => (
                        <div
                            key={i}
                            className={`dice-face ${rolling ? 'is-rolling' : ''}`}
                        >
                            <DieSprite value={die} />
                        </div>
                    ))}
                </div>

                {/* Total Display */}
                <div className="dice-total">
                    Total: {total}
                </div>

                {/* Result Message */}
                <p className={`game-result-message ${resultMessage.includes('won') ? 'is-win' : ''}`} role="status" aria-live="polite">
                    {resultMessage}
                </p>

                {/* Bet Type Selection */}
                <fieldset className="game-bet-group">
                    <legend className="form-label">Select Bet Type</legend>
                    <div className="game-choice-grid">
                        {betOptions.map(opt => (
                            <button
                                key={opt.type}
                                type="button"
                                onClick={() => setSelectedBet(opt.type)}
                                disabled={rolling}
                                className={`game-choice-button ${selectedBet === opt.type ? 'is-selected' : ''}`}
                                aria-pressed={selectedBet === opt.type}
                            >
                                <span>{opt.label}</span><small>{opt.desc}</small>
                            </button>
                        ))}
                    </div>
                </fieldset>

                {/* Exact Number Bet */}
                <div className="dice-exact">
                    <button
                        onClick={() => setSelectedBet('exact')}
                        type="button"
                        disabled={rolling}
                        className={`game-choice-button exact ${selectedBet === 'exact' ? 'is-selected' : ''}`}
                        aria-pressed={selectedBet === 'exact'}
                    >
                        Exact Number <small>6x</small>
                    </button>

                    {selectedBet === 'exact' && (
                        <div className="dice-target">
                            <label className="form-label" htmlFor="dice-target">Target Total: <strong>{exactTarget}</strong></label>
                            <input
                                id="dice-target"
                                type="range"
                                min="2"
                                max="12"
                                value={exactTarget}
                                onChange={(e) => setExactTarget(parseInt(e.target.value))}
                                disabled={rolling}
                                aria-valuetext={`Target total ${exactTarget}`}
                            />
                        </div>
                    )}
                </div>

                {/* Bet Amount */}
                <div className="game-bet-control">
                    <BetControl
                        betAmount={betAmount}
                        setBetAmount={setBetAmount}
                        disabled={rolling}
                    />
                </div>
                <p className="wager-summary">Balance ${balance.toFixed(2)} · Bet ${betAmount.toFixed(2)}</p>

                {/* Roll Button */}
                <button
                    onClick={rollDice}
                    disabled={rolling || betAmount > balance}
                    className={`primary-button w-full ${rolling ? 'btn-slate' : 'btn-red'}`}
                >
                    {rolling ? 'ROLLING...' : 'ROLL DICE'}
                </button>
            </div>

        </GameShell>
    );
}
