import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import '../../styles/KartelIntro.css';

const MN_HORIZONTAL_SPACE = 0.0016;
const MN_SCREEN_PERCENTAGE = 210000;

const angleToRadians = (degrees) => degrees * (Math.PI / 180);

const Model = ({ url, spin = false, rotation = [0, 0, 0], position = [0, 0, 0], scale = 1}) => {
  const meshRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const scalePercentage = scale * (window.innerWidth / MN_SCREEN_PERCENTAGE)

  const calculateVerticalPosition = () => {
    let verticalOffset = position[1] * MN_HORIZONTAL_SPACE * (window.innerWidth / 2);
    return verticalOffset;
  };

  useEffect(() => {
    const loader = new STLLoader();
    loader.load(url, (geom) => {
      setGeometry(geom);
      setIsLoading(false);
    }, undefined, (err) => {
      setError(err);
      setIsLoading(false);
    });
  }, [url]);

  useFrame(() => {
    if (!meshRef?.current || !spin) return;
    meshRef.current.rotation.y += 0.01;
  });

  if (isLoading) return null;

  const shinyChromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF,
    metalness: 0.1,
    roughness: 0.000,
    side: THREE.DoubleSide
  });
  
  let width = window.innerWidth;

  return (
    <mesh ref={meshRef} className="mesh"
      position={[position[0], calculateVerticalPosition(), position[2]]} 
      scale={[scalePercentage, scalePercentage, scalePercentage]} 
      rotation={[angleToRadians(rotation[0]), angleToRadians(rotation[1]), angleToRadians(rotation[2])]}
      material={shinyChromeMaterial}
    >
      <primitive object={geometry}/>
    </mesh>
  );
};

const KartelIntro = ({ setShowParticles }) => {
  const canvasRef = useRef(null);

  useEffect(() => {
    setShowParticles(false);
    return () => setShowParticles(true);
  }, [setShowParticles]);

  const handleClick = () => {
    window.location.href = '/kartelshop';
  };
  
  return (
    <div id="intro-shop" onClick={handleClick}>
      {/* <Canvas id="Canvas" ref={canvasRef}>
        <ambientLight intensity={0.25} />
        <pointLight position={[-1, 1, 0]} intensity={2} castShadow />
        <pointLight position={[-1, -1, 0]} intensity={2} castShadow />
        <Suspense fallback={<p>Loading...</p>}>
          <Model url="/Kartel.stl" spin={true} rotation={[16.5, 210, -1]} position={[0, 1, 0]} scale={1}/>
          <Model url="/Confidential.stl" rotation={[0, 270, 10]} position={[0, -2.5, 0]} scale={2.8}/>
        </Suspense>
      </Canvas> */}
      <img src="/KartelSpin.gif" className='logo-top animated-logo' alt="Spinning Kartel Logo" />
      <br></br>
      <img src="Confidential.png" className='logo-bottom confidential-logo' alt="Confidential Logo" />
    </div>
  );
};

export default KartelIntro;
