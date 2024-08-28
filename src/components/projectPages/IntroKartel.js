import React, { useEffect, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import '../../styles/IntroKartel.css';
import banner1 from '../../res/banner1.png';
import BANNER3 from '../../res/BANNER3.png';

const SpinningText = ({ text }) => {
  const meshRef = useRef(null);

  useFrame(() => {
    if (meshRef.current) {
      meshRef.current.rotation.y += 0.01;
    }
  });

  return (
    <group ref={meshRef}>
      <Text font="/fonts/helvetiker_bold.typeface.json" fontSize={1} position={[0, 0, -5]}>
        {text}
      </Text>
    </group>
  );
};

const IntroKartel = ({ setShowParticles }) => {
  const spinningImageRef = useRef(null);

  useEffect(() => {
    setShowParticles(false);
    return () => setShowParticles(true);
  }, [setShowParticles]);

  useEffect(() => {
    if (spinningImageRef.current) {
      spinningImageRef.current.style.animation = 'spin 5s linear infinite';
    }
  }, []);

  const handleClick = () => {
    window.location.href = '/kartelshop';
  };

  return (
    <div id="intro-shop" onClick={handleClick}>
      <img src={banner1} alt="Banner 1" id="img-bg"/>
      <div className="spinning-image" ref={spinningImageRef}>
        <img src={BANNER3} alt="Banner 3" />
      </div>
    </div>
  );
};

export default IntroKartel;
