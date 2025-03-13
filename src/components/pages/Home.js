import React, { useEffect, useRef } from 'react';
import { Canvas, useFrame } from "@react-three/fiber"
import * as THREE from 'three';
import { 
  FaFacebook,
  FaInstagram,
  FaWhatsapp,
  FaTwitter,
  FaGithub,
  FaLinkedin,
  FaGoogle
} from 'react-icons/fa';

const SpinningSwordLogo = () => {
  return (
    <div className="w-full h-[800px] overflow-hidden border shadow-lg">
      <Canvas camera={{ position: [0, 0, 5], fov: 45 }}>
        <ambientLight intensity={0.5} />
        <spotLight position={[10, 10, 10]} angle={0.15} penumbra={1} intensity={1} castShadow />
        <WireframeSword />
        rotation={[0, 0, Math.PI / 2]}
      </Canvas>
    </div>
  )
}


function WireframeSword() {
  const swordRef = useRef(null);

  // Rotate the sword slowly on X, Y, and Z axes
  useFrame(({ clock }) => {
    if (swordRef.current) {
      swordRef.current.rotation.x = clock.getElapsedTime() * 0.005; // Rotation on X
      swordRef.current.rotation.y = clock.getElapsedTime() * 0.5; // Rotation on Y
      swordRef.current.rotation.z = clock.getElapsedTime() * 0.5; // Rotation on Z
    }
  });

  return (
    <group ref={swordRef}>
      {/* Blade */}
      <mesh position={[0, 0.5, 0]}>
        <boxGeometry args={[0.2, 2, 0.05]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>

      {/* Blade tip */}
      <mesh position={[0, 1.6, 0]}>
        <coneGeometry args={[0.1, 0.3, 4]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>

      {/* Guard */}
      <mesh position={[0, -0.5, 0]} rotation={[0, 0, Math.PI / 2]}>
        <boxGeometry args={[0.15, 0.8, 0.1]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>

      {/* Handle */}
      <mesh position={[0, -0.9, 0]}>
        <cylinderGeometry args={[0.05, 0.05, 0.8, 8]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>

      {/* Pommel */}
      <mesh position={[0, -1.3, 0]}>
        <sphereGeometry args={[0.1, 8, 8]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>

      {/* Ornamental details - small spheres along the blade */}
      {[-0.3, 0, 0.3].map((y, i) => (
        <mesh key={i} position={[0, y, 0]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial color="#ffffff" wireframe={true} />
        </mesh>
      ))}

      {/* Ornamental cross details on guard */}
      <mesh position={[-0.3, -0.5, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>
      <mesh position={[0.3, -0.5, 0]}>
        <boxGeometry args={[0.1, 0.1, 0.1]} />
        <meshStandardMaterial color="#ffffff" wireframe={true} />
      </mesh>
    </group>
  );
}

const Home = () => {

  return (
    <div className='home'>
      <h1>Home</h1>
      <SpinningSwordLogo  />
      <p>WELCOME</p>
      <p>Reimon <code>Testing</code> new stuff, more features coming soon</p>

      <p className="App-link">Contact me on my Social networks</p>
      <div className="social-icons">
        <a href="mailto:reimonsk8@gmail.com?subject=Hello&body=This is the body of the email." style={{ color: 'white' }}>
          <FaGoogle size={32} />
        </a>

        <a href="https://github.com/Reimonsk8" style={{ color: 'white' }}>
          <FaGithub size={32} />
        </a>

        <a href="https://twitter.com/reimonsk8" style={{ color: 'white' }}>
          <FaTwitter size={32} />
        </a>

        <a href="https://www.linkedin.com/in/reimondev/" style={{ color: 'white' }}>
          <FaLinkedin size={32} />
        </a>

        <a href="https://www.facebook.com/reimonsk8" style={{ color: 'white' }}>
          <FaFacebook size={32} />
        </a>

        <a href="https://www.instagram.com/reimonsk8/" style={{ color: 'white' }}>
          <FaInstagram size={32} />
        </a>

        <a href="https://wa.me/+1234567890" style={{ color: 'white' }}>
          <FaWhatsapp size={32} />
        </a>
      </div>
    </div>
  );
};

export default Home;
