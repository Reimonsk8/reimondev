import React, { useEffect, useRef, useState, Suspense } from 'react';
import { Canvas, useFrame, useLoader } from '@react-three/fiber';
import { Text } from '@react-three/drei';
import * as THREE from 'three';
import { STLLoader } from 'three/examples/jsm/loaders/STLLoader';
import '../../styles/KartelIntro.css';

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

const angleToRadians = (degrees) => degrees * (Math.PI / 180);

const Model = ({ url, spin = false, rotation = [16.5, 210, -1], position = [0, 0, 0], scale = 1}) => {
  const meshRef = useRef(null);
  const [geometry, setGeometry] = useState(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState(null);

  const scalePercentage = 0.00080 * scale; // 50% of the screen width
  // const [screenWidth, setScreenWidth] = useState(window.innerWidth);

  const calculateVerticalPosition = () => {
    let verticalOffset = position[1] * (0.0015) * (window.innerWidth / 2);
    console.log('verticalOffset:', verticalOffset, (window.innerWidth / 2))
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
    if (meshRef.current && spin) {
      meshRef.current.rotation.y += 0.01;
    }
    // setScreenWidth(window.innerWidth);
  });

  if (isLoading) return null;
  if (error) return <Text>Error loading model: {error.message}</Text>;

  const shinyChromeMaterial = new THREE.MeshStandardMaterial({
    color: 0xFFFFFF,
    // reflectivity: 1,
    metalness: 0.1,
    roughness: 0.000,
    // specular: 0x111111,
    shininess: 100,
    side: THREE.DoubleSide
  });

  let width = window.innerWidth;

  return (
    <mesh ref={meshRef } className="mesh"
      position={[position[0], calculateVerticalPosition(), position[2]]} 
      scale={[width * scalePercentage / 100, width * scalePercentage / 100, width * scalePercentage / 100]} 
      rotation={[angleToRadians(rotation[0]), angleToRadians(rotation[1]), angleToRadians(rotation[2])]}
      material={shinyChromeMaterial}
    >
      <primitive object={geometry}/>
    </mesh>
  );
};

const KartelIntro = ({ setShowParticles }) => {
  const spinningImageRef = useRef(null);
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
      <Canvas id="Canvas" ref={canvasRef}>
        <ambientLight intensity={0.25} />
        <pointLight position={[-1, 1, 0]} intensity={2} castShadow />
        <pointLight position={[-1, -1, 0 ]} intensity={2} castShadow />
        <Suspense fallback={<Text>Loading...</Text>}>
          <Model url="/Kartel.stl" spin={true} rotation={[16.5, 210, -1]} position={[0, 1, 0]} scale={1}/>
          <Model url="/Confidential.stl" rotation={[0, 270, 10]} position={[0, -3, 0]} scale={2}/>
        </Suspense>
      </Canvas>
    </div>
  );
};

export default KartelIntro;
