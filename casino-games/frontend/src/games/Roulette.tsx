import { useState, useRef, useEffect } from 'react';
import * as PIXI from 'pixi.js';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash, spinSound } from '../utils/fx';
import BetControl from '../components/BetControl';

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
    balance: number;
    placeBet: (amount: number, side: string) => Promise<any>;
    showModal: (title: string, body: string, type?: ModalType) => void;
    refreshWallet?: () => Promise<void>;
    refreshTransactions?: () => Promise<void>;
    onClose?: () => void;
}

type BetType = 'red' | 'black' | 'green' | 'odd' | 'even' | 'number';

const ROULETTE_NUMBERS = [
    0, 32, 15, 19, 4, 21, 2, 25, 17, 34, 6, 27, 13, 36, 11, 30, 8, 23, 10, 5,
    24, 16, 33, 1, 20, 14, 31, 9, 22, 18, 29, 7, 28, 12, 35, 3, 26
];

const RED_NUMBERS = [1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36];
// const BLACK_NUMBERS = [2, 4, 6, 8, 10, 11, 13, 15, 17, 20, 22, 24, 26, 28, 29, 31, 33, 35];

const getNumberColor = (num: number): 'red' | 'black' | 'green' => {
    if (num === 0) return 'green';
    return RED_NUMBERS.includes(num) ? 'red' : 'black';
};

/* ---------------------------------------------------------------------- */
/*                     HELPER: GENERATE WHEEL TEXTURE                     */
/* ---------------------------------------------------------------------- */
function createWheelTexture(radius: number) {
    const canvas = document.createElement('canvas');
    const size = radius * 2;
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d')!;

    const cx = radius;
    const cy = radius;
    const numSegments = ROULETTE_NUMBERS.length;
    const segmentAngle = (Math.PI * 2) / numSegments;

    // 1. Base Gold/Outer Ring
    ctx.beginPath();
    ctx.arc(cx, cy, radius, 0, Math.PI * 2);
    ctx.fillStyle = '#b7791f'; // Gold/Brown outer
    ctx.fill();

    // 2. Inner Wood Ring (lighter)
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.96, 0, Math.PI * 2);
    ctx.fillStyle = '#451a03'; // Dark wood
    ctx.fill();

    // 3. Segments
    ctx.save();
    // Rotate so 0 is at top (offset by half segment to center it)
    ctx.translate(cx, cy);
    ctx.rotate(-Math.PI / 2 - segmentAngle / 2);

    ROULETTE_NUMBERS.forEach((num, i) => {
        const angle = i * segmentAngle;
        const color = getNumberColor(num);
        const fill =
            color === 'green' ? '#166534' : color === 'red' ? '#dc2626' : '#171717';

        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.arc(0, 0, radius * 0.85, angle, angle + segmentAngle);
        ctx.fillStyle = fill;
        ctx.fill();
        ctx.stroke();

        // Inner separator lines
        ctx.strokeStyle = '#fcd34d';
        ctx.lineWidth = 1;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(
            Math.cos(angle) * radius * 0.85,
            Math.sin(angle) * radius * 0.85
        );
        ctx.stroke();

        // Numbers
        ctx.save();
        const textAngle = angle + segmentAngle / 2;
        ctx.rotate(textAngle);
        ctx.translate(radius * 0.72, 0);
        ctx.rotate(Math.PI / 2); // Rotate text to face center
        ctx.fillStyle = '#fff';
        ctx.font = 'bold 12px Arial';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText(num.toString(), 0, 0);
        ctx.restore();
    });

    ctx.restore();

    // 4. Center Gold Hub
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.35, 0, Math.PI * 2);
    const grad = ctx.createRadialGradient(cx, cy, 0, cx, cy, radius * 0.35);
    grad.addColorStop(0, '#fcd34d');
    grad.addColorStop(1, '#b45309');
    ctx.fillStyle = grad;
    ctx.fill();
    ctx.strokeStyle = '#fff';
    ctx.lineWidth = 2;
    ctx.stroke();

    // Decoration on hub
    ctx.beginPath();
    ctx.arc(cx, cy, radius * 0.15, 0, Math.PI * 2);
    ctx.fillStyle = '#78350f';
    ctx.fill();

    return PIXI.Texture.from(canvas);
}

export default function Roulette({ balance, placeBet, showModal, refreshTransactions, onClose }: GameProps) {
    const [spinning, setSpinning] = useState(false);
    const [result, setResult] = useState<number | null>(null);
    const [betAmount, setBetAmount] = useState(10);
    const [selectedBet, setSelectedBet] = useState<BetType>('red');
    const [selectedNumber, setSelectedNumber] = useState<number>(0);
    const [resultMessage, setResultMessage] = useState('Select your bet and spin!');
    const [history, setHistory] = useState<string[]>([]);

    // Pixi References
    const canvasRef = useRef<HTMLDivElement>(null);
    const appRef = useRef<PIXI.Application | null>(null);
    const wheelRef = useRef<PIXI.Sprite | null>(null);
    const ballRef = useRef<PIXI.Graphics | null>(null);

    // Animation control
    const spinningRef = useRef(false);
    const ballSpeedRef = useRef(0);
    const ballProgressRef = useRef(0); // 0 to 1 orbit
    const ballRadiusRef = useRef(110); // Start at outer rim
    const isBallDroppingRef = useRef(false);
    // Landing tween: animates the wheel so the winning number ends under the
    // top pointer. Set when the backend result is known; the ticker eases both
    // wheel rotation and ball orbit toward it, then parks.
    const landingRef = useRef<{ startRot: number; endRot: number; startAngle: number; endAngle: number; rStart: number; t0: number; dur: number } | null>(null);
    const parkedRef = useRef(false);

    useEffect(() => { spinningRef.current = spinning; }, [spinning]);

    useEffect(() => {
        if (!canvasRef.current) return;

        // Init Pixi
        const app = new PIXI.Application({
            width: 300,
            height: 300,
            backgroundAlpha: 0,
            antialias: true,
        });
        canvasRef.current.appendChild(app.view as unknown as Node);
        appRef.current = app;

        // Container
        const container = new PIXI.Container();
        container.position.set(150, 150);
        app.stage.addChild(container);

        // Wheel
        const wheelTexture = createWheelTexture(130);
        const wheel = new PIXI.Sprite(wheelTexture);
        wheel.anchor.set(0.5);
        container.addChild(wheel);
        wheelRef.current = wheel;

        // Ball Container (Static relative to stage, so we calculate orbit manually)
        const ball = new PIXI.Graphics();
        ball.beginFill(0xffffff);
        ball.drawCircle(0, 0, 5);
        ball.endFill();
        ball.beginFill(0x000000, 0.2); // Shadow
        ball.drawCircle(2, 2, 5);
        ball.endFill();
        container.addChild(ball);

        // Pointer marker at the top — the winning number lands under this.
        const pointer = new PIXI.Graphics();
        pointer.beginFill(0xfcd34d);
        pointer.moveTo(0, -118);
        pointer.lineTo(-7, -108);
        pointer.lineTo(7, -108);
        pointer.endFill();
        container.addChild(pointer);

        // Initial Ball Pos (hidden or static)
        ball.visible = false;
        ballRef.current = ball;

        // Overlay/Reflection (Cinematic)
        const overlay = new PIXI.Graphics();
        overlay.beginFill(0xffffff, 0.05);
        overlay.drawCircle(0, 0, 130);
        overlay.endFill();
        container.addChild(overlay);

        // Animation Loop
        app.ticker.add((delta) => {
            if (!wheel || !ball) return;

            // 1. Landing tween: ease wheel so winning number is under the
            //    top pointer, and the ball settles onto it.
            const landing = landingRef.current;
            if (landing) {
                const p = Math.min(1, (performance.now() - landing.t0) / landing.dur);
                const e = 1 - Math.pow(1 - p, 3); // easeOutCubic
                wheel.rotation = landing.startRot + (landing.endRot - landing.startRot) * e;
                // Ease the ball's orbit angle onto the top pointer (shortest way)
                let d = (landing.endAngle - landing.startAngle) % (Math.PI * 2);
                if (d > Math.PI) d -= Math.PI * 2;
                if (d < -Math.PI) d += Math.PI * 2;
                ballProgressRef.current = landing.startAngle + d * e;
                ballRadiusRef.current = landing.rStart + (90 - landing.rStart) * e;
                ball.x = Math.cos(ballProgressRef.current) * ballRadiusRef.current;
                ball.y = Math.sin(ballProgressRef.current) * ballRadiusRef.current;
                ball.visible = true;
                if (p >= 1) {
                    landingRef.current = null;
                    parkedRef.current = true;
                    wheel.rotation = landing.endRot;
                }
                return;
            }

            // 2. Wheel Rotation (Always rotates slowly or spins fast)
            const currentSpeed = spinningRef.current ? 0.15 : 0.005; // Base visual spin
            if (!parkedRef.current) wheel.rotation += currentSpeed * delta;

            // 3. Ball Animation
            if (spinningRef.current && ball.visible && !parkedRef.current) {
                // Ball goes COUNTER-CLOCKWISE (opposite to wheel)
                ballProgressRef.current += ballSpeedRef.current * delta;

                // Decay speed
                if (ballSpeedRef.current > 0) {
                    ballSpeedRef.current *= 0.99; // Friction
                }

                // Radius decay (Dropping in)
                if (ballSpeedRef.current < 0.08 && !isBallDroppingRef.current) {
                    isBallDroppingRef.current = true; // Start dropping
                }

                if (isBallDroppingRef.current) {
                    // Move radius towards inner slot ring (~90px)
                    const targetRadius = 90;
                    ballRadiusRef.current += (targetRadius - ballRadiusRef.current) * 0.05 * delta;
                }

                // Calculate X/Y
                const r = ballRadiusRef.current;
                const angle = ballProgressRef.current;
                ball.x = Math.cos(angle) * r;
                ball.y = Math.sin(angle) * r;
            } else if (!spinningRef.current && ball.visible && !parkedRef.current) {
                // Ball stuck to wheel — hide it when not spinning.
                ball.visible = false;
            }
        });

        return () => {
            app.destroy(true, { children: true });
        };
    }, []); // Run once on mount

    // Watch for spin state to trigger visuals
    useEffect(() => {
        if (spinning) {
            // Reset animation vars
            ballSpeedRef.current = 0.35; // Fast start
            ballRadiusRef.current = 115; // Outer rim
            ballProgressRef.current = Math.random() * Math.PI * 2;
            isBallDroppingRef.current = false;
            parkedRef.current = false;
            landingRef.current = null;

            if (ballRef.current) ballRef.current.visible = true;
        }
    }, [spinning]);


    const instructions = `🎡 Roulette Rules:
• Bet on where the ball will land
• Red/Black: 2x (numbers 1-36)
• Even/Odd: 2x (numbers 2-36)
• Green (0): 35x
• Specific Number: 35x
`;

    const spin = async () => {
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
            setResult(null);
            spinSound(3);
            playTone(300, 0.1);

        try {
            // Place bet
            const apiResult = await placeBet(betAmount, `${selectedBet}${selectedBet === 'number' ? `-${selectedNumber}` : ''}`);

            await new Promise(resolve => setTimeout(resolve, 1200));
            const match = /^(\d{1,2}) \((red|black|green)\)$/.exec(String(apiResult?.result));
            if (!match) throw new Error('Invalid roulette result from server.');
            const finalNum = Number(match[1]);
            const winningColor = match[2] as 'red' | 'black' | 'green';
            if (!ROULETTE_NUMBERS.includes(finalNum) || getNumberColor(finalNum) !== winningColor) throw new Error('Invalid roulette result from server.');

            // Compute the wheel rotation that puts the winning number under the
            // top pointer, then tween both wheel + ball onto it.
            const wheel = wheelRef.current;
            if (wheel) {
                const seg = (Math.PI * 2) / ROULETTE_NUMBERS.length;
                const idx = ROULETTE_NUMBERS.indexOf(finalNum);
                const targetMod = ((-idx * seg) % (Math.PI * 2) + Math.PI * 2) % (Math.PI * 2);
                let delta = targetMod - (wheel.rotation % (Math.PI * 2));
                if (delta < 0) delta += Math.PI * 2;
                const endRot = wheel.rotation + Math.PI * 2 * 5 + delta; // 5 full spins then land
                landingRef.current = {
                    startRot: wheel.rotation,
                    endRot,
                    startAngle: ballProgressRef.current,
                    endAngle: -Math.PI / 2, // top pointer
                    rStart: ballRadiusRef.current,
                    t0: performance.now(),
                    dur: 1800,
                };
            }
            await new Promise(resolve => setTimeout(resolve, 1800));
            const isWin = Boolean(apiResult?.isWin);
            setResult(finalNum);
            await refreshTransactions?.();
            const winAmount = Number(apiResult?.winAmount) || 0;

            if (isWin) {
                playTone(880, 0.3);
                setTimeout(() => playTone(1100, 0.2), 150);
                celebrate();
                setResultMessage(`🎉 ${finalNum} ${winningColor.toUpperCase()}! You won $${winAmount.toFixed(2)}!`);
                setHistory(prev => [`${finalNum} ${winningColor} - WON $${winAmount.toFixed(2)}`, ...prev].slice(0, 5));
            } else {
                playTone(200, 0.2);
                bustFlash();
                setResultMessage(`${finalNum} ${winningColor}. You lose.`);
                setHistory(prev => [`${finalNum} ${winningColor} - LOST $${betAmount.toFixed(2)}`, ...prev].slice(0, 5));
            }

        } catch (err: any) {
            showModal('Spin Failed', err.message || 'Could not complete spin.', 'error');
            playTone(180, 0.15);
        } finally {
            setSpinning(false);
        }
    };

    const betOptions: { type: BetType; label: string; color: string }[] = [
        { type: 'red', label: 'Red', color: '#ef4444' },
        { type: 'black', label: 'Black', color: '#1f2937' },
        { type: 'green', label: 'Green (0)', color: '#22c55e' },
        { type: 'odd', label: 'Odd', color: '#8b5cf6' },
        { type: 'even', label: 'Even', color: '#3b82f6' },
    ];

    return (
        <GameShell
            title="Roulette"
            subtitle="European single-zero wheel"
            emblem="roulette"
            history={history}
            historyTitle="Recent Spins"
            instructionsTitle="How to Play Roulette"
            instructionsBody={instructions}
            onClose={onClose}
        >
            <div className="game-placeholder roulette-game" aria-busy={spinning}>

                {/* Pixi Canvas Container */}
                <div ref={canvasRef} className="roulette-wheel pixi-canvas" aria-hidden="true">
                    {/* Result overlay inside canvas center if we wanted, but DOM is easier for text */}
                </div>

                {/* Result Display */}
                {result !== null && (
                    <div className={`roulette-result is-${getNumberColor(result)}`}>
                        <span>{result}</span>
                        <div>
                            {getNumberColor(result).toUpperCase()}
                        </div>
                    </div>
                )}

                {/* Result Message */}
                <p className={`game-result-message ${resultMessage.includes('won') ? 'is-win' : ''}`} role="status" aria-live="polite">
                    {resultMessage}
                </p>

                {/* Bet Type Selection */}
                <fieldset className="game-bet-group">
                    <legend className="form-label">Select Bet Type</legend>
                    <div className="game-choice-grid roulette-choices">
                        {betOptions.map(opt => (
                            <button
                                key={opt.type}
                                type="button"
                                onClick={() => setSelectedBet(opt.type)}
                                disabled={spinning}
                                className={`game-choice-button roulette-${opt.type} ${selectedBet === opt.type ? 'is-selected' : ''}`}
                                aria-pressed={selectedBet === opt.type}
                            >
                                {opt.label}
                            </button>
                        ))}
                    </div>
                </fieldset>

                {/* Number Selection */}
                <div className="roulette-number-bet">
                    <button
                        onClick={() => setSelectedBet('number')}
                        type="button"
                        disabled={spinning}
                        className={`game-choice-button ${selectedBet === 'number' ? 'is-selected' : ''}`}
                        aria-pressed={selectedBet === 'number'}
                    >
                        Bet on Number (35x)
                    </button>

                    {selectedBet === 'number' && (
                        <div className="roulette-number-input">
                            <label htmlFor="roulette-number" className="form-label">Number 0-36</label>
                            <input
                                id="roulette-number"
                                type="number"
                                min="0"
                                max="36"
                                value={selectedNumber}
                                onChange={(e) => setSelectedNumber(Math.min(36, Math.max(0, parseInt(e.target.value) || 0)))}
                                disabled={spinning}
                                className="form-input"
                                inputMode="numeric"
                            />
                        </div>
                    )}
                </div>

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
                    onClick={spin}
                    disabled={spinning || betAmount > balance}
                    className={`primary-button w-full ${spinning ? 'btn-slate' : 'btn-emerald'}`}
                >
                    {spinning ? 'SPINNING...' : 'SPIN WHEEL'}
                </button>
            </div>
        </GameShell>
    );
}
