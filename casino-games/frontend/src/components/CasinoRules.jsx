import { Trophy, Gem, FileText, Gamepad2, CheckCircle, Dices } from 'lucide-react';

const PAYOUTS = [
    { game: '💰 Coin Flip', payout: '2x' },
    { game: '🃏 Card Duel', payout: '2x' },
    { game: '🎡 Lucky Wheel', payout: '2x - 5x' },
    { game: '🎰 Slots', payout: '2x - 50x' },
    { game: '♠️ Blackjack', payout: '2x - 2.5x' },
    { game: '🎯 Roulette', payout: '2x - 35x' },
    { game: '🎲 Dice', payout: '2x - 6x' },
];

export default function CasinoRules({ onClose }) {
    return (
        <div className="casino-rules-overlay" onClick={onClose}>
            <div className="casino-rules" onClick={(e) => e.stopPropagation()}>
                <div className="casino-rules-header">
                    <h2><Trophy size={22} style={{ verticalAlign: 'middle' }} /> Casino 888 Rules</h2>
                    <p>Welcome to Casino 888 - Where Fortune Favors the Bold!</p>
                </div>

                <div className="casino-rules-prize">
                    <h3><Gem size={18} style={{ verticalAlign: 'middle' }} /> Play-Money Demo</h3>
                    <p className="casino-rules-prize-amount">No real money</p>
                    <p>Every chip is play-money — demo only.</p>
                </div>

                <div className="casino-rules-section">
                    <h4><FileText size={16} style={{ verticalAlign: 'middle' }} /> How Our Casino Works</h4>
                    <p>
                        All games use <strong>play-money chips</strong> — no real money is involved.
                        Each game is designed with a <strong>fixed house edge</strong>.
                    </p>
                    <p>
                        This means that, on average, the casino earns a small percentage from every bet placed.
                        The house edge varies by game (typically between <strong>1% and 15%</strong>).
                    </p>
                    <p>
                        Because of this mathematical advantage, payouts stay predictable and the demo
                        stays sustainable — while every chip you bet is play-money, not cash.
                    </p>
                    <p className="casino-rules-italic">
                        Many players may win chips today, and some may win large amounts.
                        However, the house stays ahead because total bets placed across all players
                        are statistically expected to exceed total winnings.
                    </p>
                </div>

                <div className="casino-rules-section">
                    <h4><Gamepad2 size={16} style={{ verticalAlign: 'middle' }} /> Game Payouts</h4>
                    <div className="casino-rules-payouts">
                        {PAYOUTS.map((item, i) => (
                            <div key={i} className="casino-rules-payout">
                                <span>{item.game}</span>
                                <span className="casino-rules-payout-value">{item.payout}</span>
                            </div>
                        ))}
                    </div>
                </div>

                <div className="casino-rules-trust">
                    <span><CheckCircle size={20} color="#34d399" /></span>
                    <div>
                        <p>Fair & Transparent Gaming</p>
                        <p>This allows us to maintain fair gameplay, pay winners, and continue offering prizes and services.</p>
                    </div>
                </div>

                <div className="casino-rules-close">
                    <button className="primary-button" onClick={onClose}>Got It! <Dices size={14} /></button>
                </div>
            </div>
        </div>
    );
}
