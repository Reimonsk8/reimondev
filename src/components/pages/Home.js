import React from 'react';
import {
  FaFacebook,
  FaInstagram,
  FaWhatsapp,
  FaTwitter,
  FaGithub,
  FaLinkedin,
  FaGoogle
} from 'react-icons/fa';

// Original R3F wireframe sword was replaced with an SVG of the same shape.
// It weighed ~745 KB of JS (three + @react-three/fiber) and never actually
// rendered, because its wrapper used Tailwind classes and Tailwind isn't
// installed (so the canvas had zero height).
const WireframeSword = () => (
  <div className="sword-showcase">
    <div className="sword-tilt">
      <svg
        className="sword-svg"
        viewBox="0 0 200 400"
        role="img"
        aria-label="Wireframe sword logo"
      >
        <g fill="none" stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
          {/* Blade */}
          <path d="M100 14 L112 74 L112 238 L88 238 L88 74 Z" />
          {/* Blade facets (wireframe look) */}
          <line x1="100" y1="30" x2="100" y2="232" />
          <line x1="94" y1="74" x2="106" y2="238" />
          <line x1="106" y1="74" x2="94" y2="238" />
          {/* Cross guard */}
          <rect x="52" y="238" width="96" height="18" />
          <rect x="62" y="244" width="76" height="6" />
          {/* Grip */}
          <rect x="90" y="256" width="20" height="78" />
          <line x1="90" y1="275" x2="110" y2="275" />
          <line x1="90" y1="294" x2="110" y2="294" />
          <line x1="90" y1="313" x2="110" y2="313" />
          {/* Pommel */}
          <circle cx="100" cy="352" r="14" />
          <circle cx="100" cy="352" r="6" />
        </g>
      </svg>
    </div>
  </div>
);

const Home = () => {
  return (
    <div className='home'>
      <h1>Home</h1>
      <WireframeSword />
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
