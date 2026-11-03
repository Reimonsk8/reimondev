import { FormEvent, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import BetControl from '../components/BetControl';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash, spinSound } from '../utils/fx';

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
  balance: number;
  placeBet: (amount: number, side: string) => Promise<any>;
  showModal: (title: string, body: string, type?: ModalType) => void;
  refreshWallet?: () => Promise<void>;
  refreshTransactions?: () => Promise<void>;
  onClose?: () => void;
}

const segments = ['LOSE', 'x2', 'x3', 'x4', 'x5'];

export default function LuckyWheel({ balance, placeBet, showModal, refreshTransactions, onClose }: GameProps) {
  const [loading, setLoading] = useState(false);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [history, setHistory] = useState<string[]>([]);
  const [isSpinning, setIsSpinning] = useState(false);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const wheelRef = useRef<PIXI.Container | null>(null);
  const [lastResult, setLastResult] = useState('');
  const spinningRef = useRef(false);
  const targetRotationRef = useRef(0);
  const speedRef = useRef(0);

  const instructions = 'Set a play-money bet and spin. The server decides the outcome: a win pays 2x to 5x, while LOSE pays nothing. The wheel only presents that result.';

  useEffect(() => {
    if (!canvasRef.current) return;
    const app = new PIXI.Application({
      width: 300,
      height: 300,
      backgroundAlpha: 0,
      antialias: true,
    });
    canvasRef.current.appendChild(app.view as unknown as Node);

    const wheel = new PIXI.Container();
    wheel.position.set(app.renderer.width / 2, app.renderer.height / 2);

    const radius = 118;
    segments.forEach((segment, index) => {
      const startAngle = (Math.PI * 2 * index) / segments.length;
      const endAngle = (Math.PI * 2 * (index + 1)) / segments.length;
      const graphics = new PIXI.Graphics();
      graphics.beginFill(index % 2 === 0 ? 0xbf1f1f : 0x1f1f1f);
      graphics.lineStyle(4, 0xffffff, 0.4);
      graphics.moveTo(0, 0);
      graphics.arc(0, 0, radius, startAngle, endAngle);
      graphics.closePath();
      graphics.endFill();
      wheel.addChild(graphics);

      const midAngle = (startAngle + endAngle) / 2;
      const label = new PIXI.Text(segment, {
        fill: '#fff',
        fontSize: 16,
        fontWeight: '600',
        align: 'center',
      });
      label.anchor.set(0.5, 0.5);
      label.position.set(Math.cos(midAngle) * (radius - 43), Math.sin(midAngle) * (radius - 43));
      graphics.addChild(label);
    });

    const ring = new PIXI.Graphics();
    ring.lineStyle(8, 0xffd54f, 0.9);
    ring.drawCircle(0, 0, radius + 10);
    ring.lineStyle(4, 0xffffff, 0.7);
    ring.drawCircle(0, 0, radius + 2);
    wheel.addChild(ring);

    wheelRef.current = wheel;
    app.stage.addChild(wheel);
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    const ticker = app.ticker.add(() => {
      if (!wheelRef.current) return;
      if (spinningRef.current) {
        wheelRef.current.rotation += speedRef.current;
        const diff = targetRotationRef.current - wheelRef.current.rotation;
        if (diff <= 0) {
          spinningRef.current = false;
          speedRef.current = 0;
          wheelRef.current.rotation = targetRotationRef.current % (Math.PI * 2);
          setTimeout(() => setIsSpinning(false), 200);
        } else {
          speedRef.current = Math.max(speedRef.current * 0.99, 0.02);
        }
      } else if (!reducedMotion) {
        wheelRef.current.rotation += 0.003;
      }
    });

    return () => {
      ticker.stop();
      app.destroy(true, { children: true });
    };
  }, []);

  useEffect(() => {
    spinningRef.current = isSpinning;
  }, [isSpinning]);

  const handleSpin = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const amount = betAmount;

    if (Number.isNaN(amount) || amount <= 0) {
      showModal('Invalid Bet', 'Enter a valid bet amount.', 'error');
      return;
    }

    if (amount > balance) {
      showModal('Insufficient Funds', 'Your bet exceeds your available balance.', 'error');
      return;
    }

    setLoading(true);
    targetRotationRef.current = Number.POSITIVE_INFINITY;
    speedRef.current = 0.5;
    spinningRef.current = true;
    setIsSpinning(true);
    spinSound(2);

    try {
      const result = await placeBet(amount, 'spin');
      await refreshTransactions?.();
      const won = Boolean(result?.isWin);
      const multiplier = Number(result?.multiplier);
      const targetSegment = won ? segments.indexOf(`x${multiplier}`) : 0;
      if (targetSegment < 0 || (result?.result !== 'WIN' && result?.result !== 'LOSE')) throw new Error('Invalid wheel result from server.');
      const segmentAngle = (Math.PI * 2) / segments.length;
      const pointerAngle = -Math.PI / 2;
      const segmentMid = targetSegment * segmentAngle + segmentAngle / 2;
      const current = wheelRef.current?.rotation ?? 0;
      let offset = pointerAngle - segmentMid - (current % (Math.PI * 2));
      if (offset < 0) offset += Math.PI * 2;
      targetRotationRef.current = current + Math.PI * 2 * 6 + offset;
      speedRef.current = 0.5;
      const odds = segments[targetSegment];
      const summary = won ? `${odds} · Payout $${Number(result.winAmount).toFixed(2)}` : `LOSE · Lost $${amount.toFixed(2)}`;
                setHistory((prev) => [summary, ...prev].slice(0, 3));
                playTone(won ? 820 : 240, 0.2);
                if (won) celebrate();
                else bustFlash();
      setLastResult(summary);
    } catch (err: any) {
      showModal('Bet Failed', err.response ? err.response.message : (err as Error).message, 'error');
      setLastResult('The spin could not be completed. Try again.');
      playTone(200, 0.15);
      spinningRef.current = false;
      setIsSpinning(false);
    } finally {
      setLoading(false);
    }
  };

  return (
    <GameShell
      title="Lucky Wheel"
      subtitle="Multiply your bet"
      emblem="luckywheel"
      history={history}
      historyTitle="Spin History"
      instructionsTitle="How to Play Lucky Wheel"
      instructionsBody={instructions}
      onClose={onClose}
    >
      <div className="wheel-content">
        <div className="wheel-canvas-wrapper">
          <div className="wheel-container">
            <div ref={canvasRef} className="pixi-canvas" aria-hidden="true" />
            <div className="wheel-glow" aria-hidden="true" />
          </div>
          <div className="wheel-pointer" aria-hidden="true">
            <span />
          </div>
        </div>
        <div className="wheel-text">
          <strong>Lucky Wheel</strong>
          <p role="status" aria-live="polite">{lastResult || 'Place a bet and spin to multiply your balance.'}</p>
        </div>
      </div>
      <form onSubmit={handleSpin} className="wallet-form game-controls" aria-busy={loading || isSpinning}>
        <div>
          <BetControl
            betAmount={betAmount}
            setBetAmount={setBetAmount}
            disabled={loading || isSpinning}
          />
        </div>
        <p className="wager-summary">Balance ${balance.toFixed(2)} · Possible payout 2x-5x</p>
        <button type="submit" className="primary-button w-full btn-purple" disabled={loading || isSpinning || betAmount <= 0 || betAmount > balance}>
          {loading || isSpinning ? 'Spinning...' : 'Spin Wheel'}
        </button>
      </form>
    </GameShell>
  );
}
