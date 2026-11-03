import React, { useEffect } from 'react';
import '../../styles/KartelIntro.css';

const KartelIntro = ({ setShowParticles = () => {} }) => {
  useEffect(() => {
    setShowParticles(false);
    return () => setShowParticles(true);
  }, [setShowParticles]);

  const handleClick = () => {
    window.location.href = '/kartelshop';
  };

  return (
    <div
      id="intro-shop"
      onClick={handleClick}
      style={{ backgroundImage: `url(${process.env.PUBLIC_URL}/img/kartel-bg.webp)` }}
    >
      {/*
        The commented-out R3F/STL scene used to keep three.js + STLLoader in this
        route's bundle (the models are still in public/ if you want it back).
      */}
      <img
        src={`${process.env.PUBLIC_URL}/img/kartel-spin.webp`}
        className='logo-top animated-logo'
        alt="Spinning Kartel Logo"
      />
      <br></br>
      <img
        src={`${process.env.PUBLIC_URL}/img/confidential.webp`}
        className='logo-bottom confidential-logo'
        alt="Confidential Logo"
      />
    </div>
  );
};

export default KartelIntro;
