import { FormEvent, useEffect, useRef, useState } from 'react';
import * as PIXI from 'pixi.js';
import GameShell from '../components/GameShell';
import { playTone } from '../utils/audio';
import { celebrate, bustFlash, spinSound } from '../utils/fx';
import BetControl from '../components/BetControl';

type CoinResult = {
  message: string;
  accent: string;
  display: string;
};

type ModalType = 'info' | 'success' | 'error';

interface GameProps {
  balance: number;
  placeBet: (amount: number, side: string) => Promise<any>;
  showModal: (title: string, body: string, type?: ModalType) => void;
  refreshWallet?: () => Promise<void>;
  refreshTransactions?: () => Promise<void>;
  onClose?: () => void;
}

const INITIAL_RESULT: CoinResult = {
  message: 'Waiting for your bet.',
  accent: '',
  display: '?',
};

/* ---------------------------------------------------------------------- */
/*                TEXTURA BITCOIN 3D NARANJA + BORDE DORADO               */
/*                 (look cinematográfico, rugoso, metálico)               */
/* ---------------------------------------------------------------------- */
function createBitcoinTextureCinematic(radius: number) {
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = radius * 2;
  const ctx = canvas.getContext('2d')!;

  // Fondo naranja metálico con profundidad
  const grd = ctx.createRadialGradient(
    radius * 0.7,
    radius * 0.5,
    radius * 0.1,
    radius,
    radius,
    radius
  );

  grd.addColorStop(0, '#ffe7c4');
  grd.addColorStop(0.25, '#ffb05a');
  grd.addColorStop(0.6, '#e77700');
  grd.addColorStop(1, '#361500');

  ctx.fillStyle = grd;
  ctx.beginPath();
  ctx.arc(radius, radius, radius - 5, 0, Math.PI * 2);
  ctx.fill();

  // Borde dorado 3D
  ctx.strokeStyle = '#ffd56b';
  ctx.lineWidth = 14;
  ctx.shadowBlur = 20;
  ctx.shadowColor = 'rgba(255,220,150,0.9)';
  ctx.beginPath();
  ctx.arc(radius, radius, radius - 7, 0, Math.PI * 2);
  ctx.stroke();

  // Ruido metálico
  for (let i = 0; i < 2500; i++) {
    const x = Math.random() * radius * 2;
    const y = Math.random() * radius * 2;
    const alpha = Math.random() * 0.08;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(x, y, 1, 1);
  }

  // Logo BTC tallado
  ctx.fillStyle = 'rgba(255,255,255,0.9)';
  ctx.font = `${radius * 0.9}px Arial Black`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('₿', radius, radius * 1.02);

  // Overlay brillante diagonal
  const metallic = ctx.createLinearGradient(0, 0, radius * 2, radius * 2);
  metallic.addColorStop(0, 'rgba(255,255,255,0.25)');
  metallic.addColorStop(0.4, 'rgba(255,255,255,0)');
  metallic.addColorStop(0.9, 'rgba(0,0,0,0.35)');

  ctx.fillStyle = metallic;
  ctx.beginPath();
  ctx.arc(radius, radius, radius - 5, 0, Math.PI * 2);
  ctx.fill();

  return PIXI.Texture.from(canvas);
}

/* Tipos auxiliares para partículas / shockwave */
type Particle = PIXI.Graphics & {
  vx: number;
  vy: number;
  va: number;
  life: number;
};

type Shockwave = PIXI.Graphics & {
  age: number;
  maxAge: number;
};

/* ---------------------------------------------------------------------- */
/*                     COMPONENTE PRINCIPAL DEL JUEGO                     */
/* ---------------------------------------------------------------------- */

export default function CoinFlip({
  balance,
  placeBet,
  refreshTransactions,
  showModal,
  onClose,
}: GameProps) {
  const [coinFlipping, setCoinFlipping] = useState(false);
  const [coinResult, setCoinResult] = useState<CoinResult>(INITIAL_RESULT);
  const [history, setHistory] = useState<string[]>([]);
  const [betAmount, setBetAmount] = useState<number>(10);
  const [selectedSide, setSelectedSide] = useState<'cara' | 'cruz'>('cara');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const spinningRef = useRef(false);
  const winEffectRef = useRef<(() => void) | null>(null);
  const loseEffectRef = useRef<(() => void) | null>(null);

  useEffect(() => {
    spinningRef.current = coinFlipping;
  }, [coinFlipping]);

  /* ---------------------------------------------------------------------- */
  /*                      RENDER PIXI – MODO WOW+ CINEMATIC                 */
  /* ---------------------------------------------------------------------- */
  useEffect(() => {
    if (!canvasRef.current) return;

    const app = new PIXI.Application({
      width: 300,
      height: 300,
      backgroundAlpha: 0,
      antialias: true,
    });

    canvasRef.current.appendChild(app.view as unknown as Node);

    // "Cámara" principal
    const camera = new PIXI.Container();
    app.stage.addChild(camera);

    // Escena centrada
    const scene = new PIXI.Container();
    scene.position.set(app.renderer.width / 2, app.renderer.height / 2);
    camera.addChild(scene);

    // Capa de partículas
    const particleLayer = new PIXI.Container();
    scene.addChild(particleLayer);

    const radius = 75;

    // Spotlight suave detrás de todo
    const spotlight = new PIXI.Graphics();
    spotlight.beginFill(0xffe4b3, 0.35);
    spotlight.drawCircle(0, 0, radius + 110);
    spotlight.endFill();
    spotlight.blendMode = PIXI.BLEND_MODES.ADD;
    spotlight.alpha = 0.35;
    const spotlightBlur = new PIXI.BlurFilter(16);
    spotlight.filters = [spotlightBlur];
    scene.addChild(spotlight);

    // God rays cinematográficos
    const godRays = new PIXI.Graphics();
    const rayCount = 16;
    const innerR = radius + 15;
    const outerR = radius + 130;

    for (let i = 0; i < rayCount; i++) {
      const angle = (i / rayCount) * Math.PI * 2;
      godRays.beginFill(0xffd89b, 0.19);
      godRays.moveTo(0, 0);
      godRays.lineTo(
        Math.cos(angle - 0.04) * innerR,
        Math.sin(angle - 0.04) * innerR
      );
      godRays.lineTo(
        Math.cos(angle) * outerR,
        Math.sin(angle) * outerR
      );
      godRays.lineTo(
        Math.cos(angle + 0.04) * innerR,
        Math.sin(angle + 0.04) * innerR
      );
      godRays.endFill();
    }
    godRays.alpha = 0.18;
    scene.addChild(godRays);

    // Moneda Bitcoin
    const coinTexture = createBitcoinTextureCinematic(radius);
    const coin = new PIXI.Sprite(coinTexture);
    coin.anchor.set(0.5);
    coin.position.set(0, -5);

    const coinBlur = new PIXI.BlurFilter(0.7);
    coin.filters = [coinBlur];

    // Glow cerca de la moneda
    const glow = new PIXI.Graphics();
    glow.beginFill(0xffd27a, 0.3);
    glow.drawCircle(0, 0, radius + 32);
    glow.endFill();
    glow.alpha = 0.2;
    glow.blendMode = PIXI.BLEND_MODES.ADD;
    const glowBlur = new PIXI.BlurFilter(12);
    glow.filters = [glowBlur];
    scene.addChild(glow);
    scene.addChild(coin);

    // Shockwaves
    const shockwaves: Shockwave[] = [];

    function triggerShockwave() {
      const sw = new PIXI.Graphics() as Shockwave;
      sw.age = 0;
      sw.maxAge = 40;
      sw.lineStyle(3, 0xfff5cf, 1);
      sw.drawCircle(0, 0, radius + 10);
      sw.position.set(0, 0);
      sw.alpha = 1;
      scene.addChild(sw);
      shockwaves.push(sw);
    }

    // Partículas doradas
    const particles: Particle[] = [];

    function explodeParticlesCinematic() {
      for (let i = 0; i < 45; i++) {
        const p = new PIXI.Graphics() as Particle;
        p.beginFill(0xfff2bf);
        p.drawCircle(0, 0, Math.random() * 3 + 2);
        p.endFill();

        p.x = coin.x;
        p.y = coin.y;
        p.alpha = 1;

        const a = Math.random() * Math.PI * 2;
        const speed = Math.random() * 3.5 + 1.5;
        p.vx = Math.cos(a) * speed;
        p.vy = Math.sin(a) * speed - 1; // un poco hacia arriba
        p.va = Math.random() * 0.2;
        p.life = 60;

        particles.push(p);
        particleLayer.addChild(p);
      }
    }

    // Overlay de color grading (cine)
    const grading = new PIXI.Graphics();
    grading.beginFill(0x0b1020, 0.35);
    grading.drawRect(
      -app.renderer.width / 2,
      -app.renderer.height / 2,
      app.renderer.width,
      app.renderer.height
    );
    grading.endFill();
    grading.blendMode = PIXI.BLEND_MODES.MULTIPLY;
    scene.addChildAt(grading, 0);

    // Añadimos coin y centramos spotlight
    spotlight.position.set(0, 0);
    godRays.position.set(0, 0);
    glow.position.set(0, 0);

    // Estado de animación
    let rot = 0;
    let speed = 0;
    let targetSpeed = 0;
    let t = 0;
    let cameraShake = 0;

    app.ticker.add((delta) => {
      const spinning = spinningRef.current;
      t += delta;

      targetSpeed = spinning ? 0.52 : 0.02;
      speed += (targetSpeed - speed) * 0.16;

      rot += speed * delta;
      coin.rotation = rot;

      // Fake flip 3D — real rotational flip (scale.y collapses through 0 on the
      // far side) instead of a cheap squash, so the edge-on moment reads as a
      // genuine coin turning over. The rim stays full-height on the near side.
      const flip = Math.abs(Math.cos(rot));
      coin.scale.y = Math.pow(flip, 0.65) * 1.5 + 0.08;
      coin.scale.x = 1 + speed * 0.18;

      // Motion blur según velocidad
      const blurTarget = spinning ? 7 : 0.8;
      coinBlur.blur = coinBlur.blur + (blurTarget - coinBlur.blur) * 0.15;

      // Glow respirando
      glow.alpha = spinning ? 0.45 : 0.2;
      const glowScale = spinning ? 1.22 : 1.0;
      glow.scale.set(glow.scale.x + (glowScale - glow.scale.x) * 0.12);

      // God rays rotan y pulsan
      godRays.rotation += 0.003 * delta * (spinning ? 3 : 1);
      godRays.alpha = 0.16 + Math.sin(t * 0.03) * 0.05;

      // Spotlight leve pulso
      spotlight.alpha = 0.3 + Math.cos(t * 0.02) * 0.08;

      // Cámara cinematográfica
      const targetZoom = spinning ? 1.06 : 1;
      const targetTilt = spinning ? -0.03 : 0;

      const currentScale = camera.scale.x || 1;
      const newScale = currentScale + (targetZoom - currentScale) * 0.08;
      camera.scale.set(newScale);

      camera.rotation += (targetTilt - camera.rotation) * 0.08;

      // Camera shake
      if (cameraShake > 0.1) {
        camera.x = (Math.random() - 0.5) * cameraShake;
        camera.y = (Math.random() - 0.5) * cameraShake;
        cameraShake *= 0.9;
      } else {
        camera.x += (0 - camera.x) * 0.2;
        camera.y += (0 - camera.y) * 0.2;
      }

      // Shockwaves
      shockwaves.forEach((sw, i) => {
        sw.age += delta;
        const f = sw.age / sw.maxAge;
        const scale = 1 + f * 3.2;
        sw.scale.set(scale);
        sw.alpha = 1 - f;
        if (sw.age >= sw.maxAge) {
          scene.removeChild(sw);
          shockwaves.splice(i, 1);
        }
      });

      // Partículas
      particles.forEach((p, i) => {
        p.x += p.vx;
        p.y += p.vy;
        p.rotation += p.va;
        p.life -= 1;
        p.alpha = p.life / 60;

        if (p.life <= 0) {
          particleLayer.removeChild(p);
          particles.splice(i, 1);
        }
      });
    });

    /* ---------------------- EFECTOS WIN/LOSE EXTERNOS ---------------------- */
    winEffectRef.current = () => {
      explodeParticlesCinematic();
      triggerShockwave();
      cameraShake = 20;
    };

    loseEffectRef.current = () => {
      const flash = new PIXI.Graphics();
      flash.beginFill(0xffffff, 0.55);
      flash.drawRect(0, 0, app.renderer.width, app.renderer.height);
      flash.endFill();
      flash.alpha = 1;

      // Lo ponemos sobre todo
      app.stage.addChild(flash);
      cameraShake = 14;

      setTimeout(() => {
        flash.alpha = 0;
        app.stage.removeChild(flash);
      }, 90);
    };

    return () => {
      app.destroy(true, { children: true });
    };
  }, []);

  /* ---------------------------------------------------------------------- */
  /*                     LÓGICA DE APUESTA (BACKEND)                        */
  /* ---------------------------------------------------------------------- */

  const handleCoinFlip = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const betSide = selectedSide;

    if (Number.isNaN(betAmount) || betAmount <= 0) {
      showModal('Invalid Bet', 'Enter a valid bet amount.', 'error');
      return;
    }

    if (betAmount > balance) {
      showModal(
        'Insufficient Funds',
        `Your bet exceeds your available balance (${balance.toFixed(2)}).`,
        'error',
      );
      return;
    }

                setCoinFlipping(true);
                spinSound(0.9);
    setCoinResult({
      message: 'Placing bet...',
      accent: 'spinning',
      display: '??',
    });

    try {
      const result = await placeBet(betAmount, betSide);
      await refreshTransactions?.();


                playTone(result?.isWin ? 1200 : 200, 0.22);

                if (result?.isWin) {
                    winEffectRef.current?.();
                    celebrate();
                } else {
                    loseEffectRef.current?.();
                    bustFlash();
                }

      setHistory((prev) => {
        const entry = `${result?.result?.toUpperCase() ?? betSide} - ${result?.isWin ? 'WON' : 'LOST'
          } ${betAmount.toFixed(2)}`;
        return [entry, ...prev].slice(0, 3);
      });

      const outcome = result?.result;
      if (outcome !== 'cara' && outcome !== 'cruz') throw new Error('Invalid coin result from server.');

      setCoinResult({
        message: result?.message || (result?.isWin ? 'You won!' : 'Keep trying'),
        accent: result?.isWin ? 'positive' : 'negative',
        display: outcome === 'cara' ? 'HEADS' : 'TAILS',
      });
    } catch (err: any) {
      showModal(
        'Bet Failed',
        err?.response?.message ?? err?.message ?? 'Unknown error',
        'error',
      );
      playTone(180, 0.18);
      setCoinResult({ message: 'The bet could not be completed. Try again.', accent: 'negative', display: '!' });
    } finally {
      setCoinFlipping(false);
    }
  };

  /* ---------------------------------------------------------------------- */
  /*                                UI JSX                                  */
  /* ---------------------------------------------------------------------- */

  return (
    <GameShell
      title="Coin Flip"
      subtitle="Double or nothing - Cinematic BTC"
      emblem="coinflip"
      history={history}
      historyTitle="Flip History"
      instructionsTitle="How to Play Coin Flip"
      instructionsBody="Pick a side, set your bet and flip the coin. You win if the result matches your pick."
      onClose={onClose}
    >
      <div className="coin-stage">
        <div className="coin-ring">
          <div ref={canvasRef} className="pixi-canvas" aria-hidden="true" />
        </div>
      </div>

      <form onSubmit={handleCoinFlip} className="coin-form game-controls" aria-busy={coinFlipping}>
        <BetControl
          betAmount={betAmount}
          setBetAmount={setBetAmount}
          disabled={coinFlipping}
        />

        <fieldset className="game-bet-group">
        <legend className="form-label">Select your side</legend>
        <div className="coin-options">
          <button
            type="button"
            onClick={() => setSelectedSide('cara')}
            className={`coin-side-btn ${selectedSide === 'cara' ? 'active' : ''}`}
            disabled={coinFlipping}
            aria-pressed={selectedSide === 'cara'}
          >
            <span className="coin-face-mark heads" aria-hidden="true">H</span>
            HEADS
          </button>
          <button
            type="button"
            onClick={() => setSelectedSide('cruz')}
            className={`coin-side-btn ${selectedSide === 'cruz' ? 'active' : ''}`}
            disabled={coinFlipping}
            aria-pressed={selectedSide === 'cruz'}
          >
            <span className="coin-face-mark tails" aria-hidden="true">T</span>
            TAILS
          </button>
        </div>
        </fieldset>
        <p className="wager-summary">Balance ${balance.toFixed(2)} · Payout 2x</p>

        <button type="submit" disabled={coinFlipping || betAmount <= 0 || betAmount > balance} className="primary-button w-full btn-amber">
          {coinFlipping ? 'Flipping...' : 'Flip Coin'}
        </button>
      </form>

      <div className="coin-result" role="status" aria-live="polite">
        <div className={`coin-display ${coinResult.accent} ${coinFlipping ? 'spinning' : ''}`}>
          {coinFlipping ? '??' : coinResult.display}
        </div>
        <p>{coinResult.message}</p>
      </div>
    </GameShell>
  );
}
