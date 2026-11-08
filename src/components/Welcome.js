import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { createIntroParticles } from './introParticles';
import '../styles/Welcome.css';

const Welcome = () => {
  const navigate = useNavigate();
  const canvasRef = useRef(null);
  const engineRef = useRef(null);

  const [outro, setOutro] = useState(false);
  const [enterSite, setEnterSite] = useState(false);
  const [renderer, setRenderer] = useState('webgl');

  useEffect(() => {
    const engine = createIntroParticles(canvasRef.current, renderer);
    if (!engine) {
      if (renderer === 'webgl') setRenderer('2d');
      return undefined;
    }

    engineRef.current = engine;

    return () => {
      engine.destroy();
      if (engineRef.current === engine) engineRef.current = null;
    };
  }, [renderer]);

  useEffect(() => {
    const outroTimer = setTimeout(() => setOutro(true), 1000);
    return () => clearTimeout(outroTimer);
  }, []);

  useEffect(() => {
    if (!enterSite) return undefined;

    engineRef.current?.stop();
    const enterTimer = setTimeout(() => {
      navigate('/home', { replace: true });
    }, 2000);

    return () => clearTimeout(enterTimer);
  }, [enterSite, navigate]);

  const getBackgroundStyle = () => {
    if (!outro && !enterSite) return 'intro-background';
    if (enterSite) return 'entersite-background';
    return 'outro-background';
  };

  const onIntroFinished = () => {
    setEnterSite(true);
  };

  return (
    <div id="WelcomeComponentBody" className={getBackgroundStyle()}>
      {/* Enter button container*/}
      <div className="bottom-container">
        <button type="button" className="skip" onClick={onIntroFinished}>
          Enter
          <span className="shift" aria-hidden="true">›</span>
          <span className="mask" aria-hidden="true" />
        </button>
      </div>
      {/* Particle intro canvas */}
      <canvas id="IntroParticleCanvas" key={renderer} ref={canvasRef} />
    </div>
  );
};

export default Welcome;
