import { useState, useEffect, useRef } from 'react';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash, spinSound } from '../utils/fx';
import BetControl from '../components/BetControl';
import { SlotSymbol } from '../components/GameArt';

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
    balance: number;
    placeBet: (amount: number, side: string) => Promise<any>;
    showModal: (title: string, body: string, type?: ModalType) => void;
    refreshWallet?: () => Promise<void>;
    refreshTransactions?: () => Promise<void>;
    onClose?: () => void;
}

const SYMBOLS = ['💎', '🍀', '🍒', '🍋', '🍊', '🍇', '🍉', '⭐'];

const PAYTABLE: Record<string, number> = {
    '💎': 50,  // Diamond - highest
    '🍀': 25,  // Clover
    '🍒': 15,  // Cherry
    '⭐': 10,  // Star
    '🍋': 8,   // Lemon
    '🍊': 6,   // Orange
    '🍇': 5,   // Grapes
    '🍉': 4,   // Watermelon
};

export default function Slots({ balance, placeBet, showModal, refreshTransactions, onClose }: GameProps) {
    const [reels, setReels] = useState<string[]>(['💎', '🍀', '🍒']);
    const [spinning, setSpinning] = useState(false);
    const [betAmount, setBetAmount] = useState(10);
    const [resultMessage, setResultMessage] = useState('Match 3 symbols to win big!');
    const [history, setHistory] = useState<string[]>([]);
    const [lastWin, setLastWin] = useState(0);
    const spinIntervalRefs = useRef<NodeJS.Timeout[]>([]);

    const instructions = `🎰 Slot Machine Rules:
• Match all 3 symbols to win the jackpot (multiplier shown in paytable)
• Match 2 symbols to win 2x your bet
• Different symbols = try again!

💎 Paytable (3 matches):
💎 Diamond: 50x | 🍀 Clover: 25x | 🍒 Cherry: 15x
⭐ Star: 10x | 🍋 Lemon: 8x | 🍊 Orange: 6x
🍇 Grapes: 5x | 🍉 Watermelon: 4x`;

    // Cleanup intervals on unmount
    useEffect(() => {
        return () => {
            spinIntervalRefs.current.forEach(clearInterval);
        };
    }, []);

    const spinReels = async () => {
        if (spinning) return;

        if (betAmount <= 0) {
            showModal('Invalid Bet', 'Please enter a bet amount greater than 0.', 'error');
            return;
        }

        if (betAmount > balance) {
            showModal('Insufficient Funds', 'Your bet exceeds your available balance.', 'error');
            return;
        }

            setSpinning(true);
            setResultMessage('Spinning...');
            setLastWin(0);
            spinSound(2);

        // Clear previous intervals
        spinIntervalRefs.current.forEach(clearInterval);
        spinIntervalRefs.current = [];

        // Start spinning animation for each reel
        const spinningReels = [...reels];

        for (let i = 0; i < 3; i++) {
            const interval = setInterval(() => {
                spinningReels[i] = SYMBOLS[Math.floor(Math.random() * SYMBOLS.length)];
                setReels([...spinningReels]);
            }, 100);
            spinIntervalRefs.current.push(interval);
        }

        try {
            // Place the bet through backend (server decides the outcome)
            const result = await placeBet(betAmount, 'slots');

            // Wait for spin animation
            await new Promise(resolve => setTimeout(resolve, 500));

            // Stop reels one by one using the server-selected symbols
            const finalSymbols = result?.symbols;
            if (!Array.isArray(finalSymbols) || finalSymbols.length !== 3 || finalSymbols.some((symbol) => !SYMBOLS.includes(symbol))) {
                throw new Error('Invalid slot result from server.');
            }
            for (let i = 0; i < 3; i++) {
                await new Promise(resolve => setTimeout(resolve, 400));
                clearInterval(spinIntervalRefs.current[i]);

                spinningReels[i] = finalSymbols[i];
                setReels([...spinningReels]);
                playTone(300 + (i * 100), 0.1);
            }

            const winAmount = Number(result?.winAmount) || 0;

            // Refresh data
            await refreshTransactions?.();

            if (winAmount > 0) {
                playTone(880, 0.3);
                setTimeout(() => playTone(1100, 0.3), 150);
                celebrate();
                setLastWin(winAmount);
                setResultMessage(result?.message || `You won $${winAmount.toFixed(2)}!`);
                setHistory(prev => [`${spinningReels.join(' ')} - WON $${winAmount.toFixed(2)}`, ...prev].slice(0, 5));
            } else {
                playTone(200, 0.2);
                bustFlash();
                setResultMessage(result?.message || 'No match. Try again!');
                setHistory(prev => [`${spinningReels.join(' ')} - LOST $${betAmount.toFixed(2)}`, ...prev].slice(0, 5));
            }

        } catch (err: any) {
            showModal('Spin Failed', err.message || 'Could not complete spin.', 'error');
            playTone(180, 0.15);
        } finally {
            spinIntervalRefs.current.forEach(clearInterval);
            setSpinning(false);
        }
    };
    return (
        <GameShell
            title="Slot Machine"
            subtitle="Three reels · eight symbols · up to 50x"
            emblem="slots"
            history={history}
            historyTitle="Recent Spins"
            instructionsTitle="How to Play Slots"
            instructionsBody={instructions}
            onClose={onClose}
        >
            <div className="game-placeholder slots-game" aria-busy={spinning}>
                {/* Slot Display */}
                <div className="slots-cabinet" aria-hidden="true">
                    {reels.map((symbol, index) => (
                        <div
                            key={index}
                            className={`slots-reel ${spinning ? 'is-spinning' : ''}`}
                        >
                            <SlotSymbol symbol={symbol} />
                        </div>
                    ))}
                </div>

                {/* Last Win Display */}
                {lastWin > 0 && (
                    <div className="slots-payout">
                        Payout ${lastWin.toFixed(2)}
                    </div>
                )}

                {/* Result Message */}
                <p className={`game-result-message ${resultMessage.includes('won') || resultMessage.includes('JACKPOT') ? 'is-win' : ''}`} role="status" aria-live="polite">
                    {resultMessage}
                </p>

                {/* Bet Control */}
                <div className="game-bet-control">
                    <BetControl
                        betAmount={betAmount}
                        setBetAmount={setBetAmount}
                        disabled={spinning}
                    />
                </div>
                <p className="wager-summary">Balance ${balance.toFixed(2)} · Bet ${betAmount.toFixed(2)}</p>

                {/* Spin Button */}
                <button
                    onClick={spinReels}
                    disabled={spinning || betAmount > balance}
                    className={`primary-button w-full ${spinning ? 'btn-slate' : 'btn-amber'}`}
                >
                    {spinning ? 'SPINNING...' : 'SPIN REELS'}
                </button>

                {/* Mini Paytable */}
                <div className="slots-paytable">
                    <strong>Paytable</strong>
                    <div>
                        {Object.entries(PAYTABLE).map(([symbol, mult]) => (
                            <span key={symbol}><SlotSymbol symbol={symbol} compact /> x{mult}</span>
                        ))}
                    </div>
                </div>
            </div>

        </GameShell>
    );
}
