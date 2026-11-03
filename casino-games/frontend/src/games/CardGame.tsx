import { FormEvent, useState } from 'react';
import BetControl from '../components/BetControl';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash } from '../utils/fx';

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
  balance: number;
  placeBet: (amount: number, side: string) => Promise<any>;
  showModal: (title: string, body: string, type?: ModalType) => void;
  refreshWallet?: () => Promise<void>;
  refreshTransactions?: () => Promise<void>;
  onClose?: () => void;
}

const deck = [
  { symbol: 'A', suit: '♠', color: 'negro' },
  { symbol: 'K', suit: '♥', color: 'rojo' },
  { symbol: 'Q', suit: '♦', color: 'rojo' },
  { symbol: 'J', suit: '♣', color: 'negro' },
  { symbol: '10', suit: '♠', color: 'negro' },
  { symbol: '9', suit: '♥', color: 'rojo' },
];

export default function CardGame({ balance, placeBet, showModal, refreshTransactions, onClose }: GameProps) {
  const [card, setCard] = useState<(typeof deck)[number] | null>(null);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [loading, setLoading] = useState(false);
  const [resultMessage, setResultMessage] = useState('Guess red or black and win the pot.');
  const [history, setHistory] = useState<string[]>([]);
  const [pulse, setPulse] = useState(false);

  const instructions = 'Bet on a color, the card is revealed and you win if it matches your choice.';

  const handleBet = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formData = new FormData(event.currentTarget);
    const amount = betAmount;
    const sideChoice = formData.get('color')?.toString() || 'rojo';

    if (Number.isNaN(amount) || amount <= 0) {
      showModal('Invalid Bet', 'Enter a bet amount greater than zero.', 'error');
      return;
    }

    if (amount > balance) {
      showModal('Insufficient Funds', 'Your bet exceeds your available balance.', 'error');
      return;
    }

    setLoading(true);
    setCard(null);
    setResultMessage('The dealer is drawing...');

    try {
      const result = await placeBet(amount, sideChoice);
      await refreshTransactions?.();
      const resultColor = result?.result;
      if (resultColor !== 'rojo' && resultColor !== 'negro') throw new Error('Invalid card result from server.');
      const matchingCards = deck.filter((item) => item.color === resultColor);
      const drawnCard = matchingCards[Math.floor(Math.random() * matchingCards.length)];
      setCard(drawnCard);
      setPulse(true);
      setTimeout(() => setPulse(false), 400);
      const win = Boolean(result?.isWin);
            playTone(win ? 640 : 250, 0.2);
            if (win) celebrate();
            else bustFlash();
      setResultMessage(
        `${drawnCard.symbol}${drawnCard.suit} was ${drawnCard.color === 'rojo' ? 'red' : 'black'}. ${win ? `Payout $${Number(result.winAmount).toFixed(2)}.` : `Lost $${amount.toFixed(2)}.`}`,
      );
      setHistory((prev) => {
        const entry = `${drawnCard.symbol}${drawnCard.suit} - ${win ? 'WON' : 'LOST'} ${amount.toFixed(2)}`;
        return [entry, ...prev].slice(0, 3);
      });
    } catch (err: any) {
      showModal('Bet Failed', err.response ? err.response.message : (err as Error).message, 'error');
      setResultMessage('The bet could not be completed. Try again.');
      playTone(180, 0.15);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GameShell
      title="Card Duel"
      subtitle="Guess the color and win"
      emblem="cardgame"
      history={history}
      historyTitle="Card History"
      instructionsTitle="How to Play Card Duel"
      instructionsBody={instructions}
      onClose={onClose}
    >
      <div className="game-placeholder">
        <p className="game-kicker">Dealer's card</p>
        <div className={`card-visual ${card ? (card.color === 'rojo' ? 'card-red' : 'card-black') : 'card-back'} ${pulse ? 'card-flare' : ''}`} aria-hidden="true">
          {card && <><span className="card-corner top">{card.symbol}<small>{card.suit}</small></span><span className="card-center">{card.suit}</span><span className="card-corner bottom">{card.symbol}<small>{card.suit}</small></span></>}
        </div>
        <p className="game-result-message" role="status" aria-live="polite">{resultMessage}</p>
        <form onSubmit={handleBet} className="wallet-form game-controls" aria-busy={loading}>
          <div>
            <BetControl
              betAmount={betAmount}
              setBetAmount={setBetAmount}
              disabled={loading}
            />
          </div>
          <div className="coin-options">
            <label className="coin-option">
              <input type="radio" name="color" value="rojo" defaultChecked disabled={loading} />
              <span>Bet Red</span>
            </label>
            <label className="coin-option">
              <input type="radio" name="color" value="negro" disabled={loading} />
              <span>Bet Black</span>
            </label>
          </div>
          <p className="wager-summary">Balance ${balance.toFixed(2)} · Payout 2x</p>
          <button type="submit" className="primary-button w-full btn-red" disabled={loading || betAmount <= 0 || betAmount > balance}>
            {loading ? 'Betting...' : 'Bet on color'}
          </button>
        </form>
      </div>
    </GameShell>
  );
}
