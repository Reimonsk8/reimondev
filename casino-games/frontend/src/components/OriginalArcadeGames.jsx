import { useEffect, useRef, useState } from 'react';
import { ArrowLeft, ArrowRight, RotateCcw, X } from 'lucide-react';

const BEST_PREFIX = 'c888_arcade_best_';
const readBest = (id) => Number(localStorage.getItem(`${BEST_PREFIX}${id}`) || 0);
const saveBest = (id, score) => {
  const best = Math.max(readBest(id), score);
  localStorage.setItem(`${BEST_PREFIX}${id}`, String(best));
  return best;
};

function GameFrame({ title, subtitle, score, best, running, onStart, onClose, children }) {
  const isRecord = score > 0 && score >= best;
  return (
    <div className="original-game-overlay" role="dialog" aria-modal="true" aria-label={title}>
      <div className="original-game-modal">
        <header>
          <div><p className="eyebrow">ReimonDev Arcade</p><h2>{title}</h2><span>{subtitle}</span></div>
          <div className="original-game-score"><span>Score <b>{score}</b></span><span>Best <b>{best}</b></span></div>
          <button type="button" className="original-game-close" onClick={onClose} aria-label="Close game"><X /></button>
        </header>
        <div className="original-game-stage">
          <div className="original-game-bezel">
            <div className="original-game-hud"><span>PLAYER 1</span><b>{running ? 'RUNNING' : score ? (isRecord ? 'HIGH SCORE' : 'RUN COMPLETE') : 'READY'}</b></div>
            <div className="original-game-viewport">{children}</div>
            {!running && <div className={`original-game-state ${isRecord ? 'is-record' : ''}`}><strong>{score ? (isRecord ? 'NEW RECORD' : 'RUN COMPLETE') : 'READY'}</strong><span>{score ? `${score} POINTS` : 'PRESS START'}</span></div>}
          </div>
        </div>
        {!running && <button type="button" className="original-game-start" onClick={onStart}><RotateCcw size={18} /> {score ? 'Play again' : 'Start game'}</button>}
      </div>
    </div>
  );
}

function NeonBreaker({ onClose }) {
  const canvasRef = useRef(null);
  const controlsRef = useRef({ left: false, right: false, pointer: null });
  const [running, setRunning] = useState(false);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest('neon-breaker'));
  const [stage, setStage] = useState(1);

  useEffect(() => {
    if (!running || !canvasRef.current) return undefined;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    let frame;
    let paddleX = 210;
    let ball = { x: 260, y: 245, vx: 3.2, vy: -3.2, radius: 7 };
    let bricks = Array.from({ length: 24 }, (_, i) => ({ x: 28 + (i % 8) * 59, y: 36 + Math.floor(i / 8) * 30, alive: true, hue: 150 + (i % 8) * 18 }));
    let currentScore = 0;
    let currentStage = 1;
    const trail = [];

    const key = (event, down) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') controlsRef.current.left = down;
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') controlsRef.current.right = down;
    };
    const down = (event) => key(event, true);
    const up = (event) => key(event, false);
    window.addEventListener('keydown', down);
    window.addEventListener('keyup', up);

    const draw = () => {
      ctx.clearRect(0, 0, 520, 320);
      const sky = ctx.createLinearGradient(0, 0, 0, 320);
      sky.addColorStop(0, '#050112'); sky.addColorStop(.62, '#12052d'); sky.addColorStop(1, '#02050d');
      ctx.fillStyle = sky; ctx.fillRect(0, 0, 520, 320);
      ctx.strokeStyle = 'rgba(96,165,250,.16)';
      for (let x = -260; x < 780; x += 52) { ctx.beginPath(); ctx.moveTo(260, 165); ctx.lineTo(x, 320); ctx.stroke(); }
      for (let y = 175; y < 320; y += 24) { ctx.beginPath(); ctx.moveTo(0, y); ctx.lineTo(520, y); ctx.stroke(); }
      ctx.fillStyle = 'rgba(192,132,252,.35)'; ctx.fillRect(0, 162, 520, 2);

      if (controlsRef.current.left) paddleX -= 7;
      if (controlsRef.current.right) paddleX += 7;
      if (controlsRef.current.pointer !== null) paddleX += (controlsRef.current.pointer - paddleX - 50) * 0.25;
      paddleX = Math.max(8, Math.min(412, paddleX));

      ball.x += ball.vx;
      ball.y += ball.vy;
      if (ball.x < ball.radius || ball.x > 520 - ball.radius) ball.vx *= -1;
      if (ball.y < ball.radius) ball.vy = Math.abs(ball.vy);
      if (ball.y > 282 && ball.y < 302 && ball.x > paddleX && ball.x < paddleX + 100 && ball.vy > 0) {
        ball.vy = -Math.abs(ball.vy);
        ball.vx += ((ball.x - (paddleX + 50)) / 50) * 1.5;
      }

      bricks.forEach((brick) => {
        if (!brick.alive) return;
        if (ball.x + ball.radius > brick.x && ball.x - ball.radius < brick.x + 51 && ball.y + ball.radius > brick.y && ball.y - ball.radius < brick.y + 18) {
          brick.alive = false;
          ball.vy *= -1;
          currentScore += 100 * currentStage;
          setScore(currentScore);
        }
        if (brick.alive) {
          ctx.shadowBlur = 10; ctx.shadowColor = `hsl(${brick.hue} 90% 60%)`; ctx.fillStyle = `hsl(${brick.hue} 75% 43%)`;
          ctx.fillRect(brick.x, brick.y, 51, 18); ctx.fillStyle = `hsl(${brick.hue} 90% 72%)`; ctx.fillRect(brick.x + 2, brick.y + 2, 47, 4);
          ctx.fillStyle = 'rgba(0,0,0,.28)'; ctx.fillRect(brick.x + 2, brick.y + 14, 47, 2); ctx.shadowBlur = 0;
        }
      });

      if (bricks.every((brick) => !brick.alive)) {
        currentStage += 1; setStage(currentStage);
        bricks = bricks.map((brick) => ({ ...brick, alive: true }));
        ball = { x: 260, y: 245, vx: 3.2 + currentStage * 0.35, vy: -3.2 - currentStage * 0.35, radius: 7 };
      }

      ctx.shadowBlur = 16; ctx.shadowColor = '#54ffca'; ctx.fillStyle = '#1da77d'; ctx.beginPath(); ctx.moveTo(paddleX,302);ctx.lineTo(paddleX+13,287);ctx.lineTo(paddleX+87,287);ctx.lineTo(paddleX+100,302);ctx.closePath();ctx.fill();
      ctx.fillStyle='#c7ffed';ctx.fillRect(paddleX+22,290,56,5);ctx.fillStyle='#54ffca';ctx.fillRect(paddleX+4,299,18,5);ctx.fillRect(paddleX+78,299,18,5);
      trail.unshift({x:ball.x,y:ball.y}); if(trail.length>6) trail.pop(); trail.forEach((point,index)=>{ctx.globalAlpha=(6-index)/18;ctx.fillStyle='#54ffca';ctx.beginPath();ctx.arc(point.x,point.y,Math.max(2,ball.radius-index),0,Math.PI*2);ctx.fill();});ctx.globalAlpha=1;
      ctx.shadowColor = '#fff'; ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.arc(ball.x, ball.y, ball.radius, 0, Math.PI * 2); ctx.fill(); ctx.shadowBlur = 0;
      ctx.fillStyle = '#c084fc'; ctx.font = 'bold 13px monospace'; ctx.fillText(`STAGE ${currentStage}`, 12, 20);

      if (ball.y > 330) {
        setBest(saveBest('neon-breaker', currentScore));
        setRunning(false);
        return;
      }
      frame = requestAnimationFrame(draw);
    };
    frame = requestAnimationFrame(draw);
    return () => { cancelAnimationFrame(frame); window.removeEventListener('keydown', down); window.removeEventListener('keyup', up); };
  }, [running]);

  const start = () => { setScore(0); setStage(1); setRunning(true); };
  const pointer = (event) => {
    const rect = canvasRef.current.getBoundingClientRect();
    controlsRef.current.pointer = ((event.clientX - rect.left) / rect.width) * 520;
  };
  return <GameFrame title="Neon Breaker" subtitle={`Stage ${stage} · Move with arrows, A/D, touch or mouse`} score={score} best={best} running={running} onStart={start} onClose={onClose}><canvas ref={canvasRef} className="breaker-canvas" width="520" height="320" onPointerMove={pointer} onPointerLeave={() => { controlsRef.current.pointer = null; }} /><div className="original-touch-row"><button onPointerDown={() => { controlsRef.current.left = true; }} onPointerUp={() => { controlsRef.current.left = false; }}><ArrowLeft /></button><button onPointerDown={() => { controlsRef.current.right = true; }} onPointerUp={() => { controlsRef.current.right = false; }}><ArrowRight /></button></div></GameFrame>;
}

function Hyperlane({ onClose }) {
  const [running, setRunning] = useState(false);
  const [lane, setLane] = useState(1);
  const [obstacles, setObstacles] = useState([]);
  const [score, setScore] = useState(0);
  const [best, setBest] = useState(() => readBest('hyperlane'));

  useEffect(() => {
    if (!running) return undefined;
    const move = (event) => {
      if (event.key === 'ArrowLeft' || event.key.toLowerCase() === 'a') setLane((value) => Math.max(0, value - 1));
      if (event.key === 'ArrowRight' || event.key.toLowerCase() === 'd') setLane((value) => Math.min(2, value + 1));
    };
    window.addEventListener('keydown', move);
    const timer = setInterval(() => {
      setObstacles((current) => {
        const moved = current.map((item) => ({ ...item, row: item.row + 1 }));
        if (moved.some((item) => item.row >= 5 && item.lane === lane)) {
          setBest(saveBest('hyperlane', score)); setRunning(false); return moved;
        }
        const cleared = moved.filter((item) => item.row < 6);
        const passed = moved.length - cleared.length;
        if (passed) setScore((value) => value + passed * 75);
        if (Math.random() < 0.7) cleared.push({ id: `${Date.now()}-${Math.random()}`, lane: Math.floor(Math.random() * 3), row: 0 });
        return cleared;
      });
    }, Math.max(170, 420 - Math.floor(score / 300) * 25));
    return () => { clearInterval(timer); window.removeEventListener('keydown', move); };
  }, [running, lane, score]);

  const start = () => { setLane(1); setObstacles([]); setScore(0); setRunning(true); };
  return <GameFrame title="Hyperlane" subtitle="Dodge traffic · arrows, A/D or touch" score={score} best={best} running={running} onStart={start} onClose={onClose}><div className="hyperlane-board">{Array.from({ length: 18 }, (_, index) => { const cellLane = index % 3; const row = Math.floor(index / 3); const obstacle = obstacles.some((item) => item.lane === cellLane && item.row === row); const player = row === 5 && lane === cellLane; return <div key={index} className={`hyperlane-cell ${obstacle ? 'is-obstacle' : ''} ${player ? 'is-player' : ''}`}>{obstacle && <span className="hyperlane-obstacle-sprite" aria-hidden="true" />}{player && <span className="hyperlane-player-sprite" aria-hidden="true" />}</div>; })}</div><div className="original-touch-row"><button onClick={() => setLane((value) => Math.max(0, value - 1))}><ArrowLeft /></button><button onClick={() => setLane((value) => Math.min(2, value + 1))}><ArrowRight /></button></div></GameFrame>;
}

function PulseGrid({ onClose }) {
  const [running, setRunning] = useState(false);
  const [target, setTarget] = useState(4);
  const [score, setScore] = useState(0);
  const [seconds, setSeconds] = useState(20);
  const [best, setBest] = useState(() => readBest('pulse-grid'));
  const [lastHit, setLastHit] = useState(null);

  useEffect(() => {
    if (!running) return undefined;
    const timer = setInterval(() => setSeconds((value) => {
      if (value <= 1) { setBest(saveBest('pulse-grid', score)); setRunning(false); return 0; }
      return value - 1;
    }), 1000);
    return () => clearInterval(timer);
  }, [running, score]);

  const start = () => { setTarget(Math.floor(Math.random() * 16)); setScore(0); setSeconds(20); setRunning(true); };
  const hit = (index) => {
    if (!running || index !== target) return;
    setLastHit(index);
    setTimeout(() => setLastHit(null), 220);
    setScore((value) => value + 100 + seconds * 2);
    setTarget((current) => { let next = current; while (next === current) next = Math.floor(Math.random() * 16); return next; });
  };
  return <GameFrame title="Pulse Grid" subtitle={`${seconds}s · hit the active signal`} score={score} best={best} running={running} onStart={start} onClose={onClose}><div className="pulse-time-meter"><i style={{ width: `${seconds * 5}%` }} /></div><div className="pulse-grid">{Array.from({ length: 16 }, (_, index) => <button type="button" key={index} className={`${running && index === target ? 'is-target' : ''} ${index === lastHit ? 'is-hit' : ''}`} onClick={() => hit(index)} aria-label={running && index === target ? 'Active target' : 'Inactive cell'} />)}</div></GameFrame>;
}

export default function OriginalArcadeGame({ gameId, onClose }) {
  useEffect(() => {
    const close = (event) => { if (event.key === 'Escape') onClose(); };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, [onClose]);
  if (gameId === 'neon-breaker') return <NeonBreaker onClose={onClose} />;
  if (gameId === 'hyperlane') return <Hyperlane onClose={onClose} />;
  return <PulseGrid onClose={onClose} />;
}
