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

  useEffect(() => {
    const engine = createIntroParticles(canvasRef.current);
    engineRef.current = engine;

    const outroTimer = setTimeout(() => setOutro(true), 1000);

    return () => {
      clearTimeout(outroTimer);
      engine?.destroy();
      engineRef.current = null;
    };
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
        <div className="skip" onClick={onIntroFinished}>
          <a href={null}>
            Enter
            <span className="shift">›</span>
          </a>
          <div className="mask"></div>
        </div>
      </div>
      {/* Particle intro canvas */}
      <canvas id="IntroParticleCanvas" ref={canvasRef} />
    </div>
  );
};

export default Welcome;
