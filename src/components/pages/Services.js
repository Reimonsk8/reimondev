import React, { useEffect } from 'react';
import { 
  FaFacebook,
  FaInstagram,
  FaWhatsapp,
  FaTwitter,
  FaGithub,
  FaLinkedin,
  FaGoogle
} from 'react-icons/fa';
import "../../styles/Services.css"; // Add a new CSS file for better styling

const Services = () => {

  return (
    <div className='services-container rt-video-container'>
      <h1 className="fade-in">🔥 3D Projection Mapping</h1>
      <p className="fade-in">Custom solutions for live events, music festivals, DJ booths, and more.</p>

      <div className="service-grid ">
        <div className="service-card fade-in">
          <img 
            src="https://media2.giphy.com/media/wCQi0lZr7Fs08/giphy-downsized.gif" 
            alt="Projection Mapping Example 1" 
            className="service-image" 
          />
          <p>Festival Stage Mapping</p>
        </div>
        <div className="service-card fade-in">
          <img 
            src="https://progresionaudiovisual.com/sites/default/files/2024-06/Demo-Mapping-DJ-2.jpg" 
            alt="Projection Mapping Example 2" 
            className="service-image" 
          />
          <p>DJ Booth Visuals</p>
        </div>
        <div className="service-card fade-in">
          <img 
            src="https://ukiproductions.com/images/3d-mapping-2.jpg" 
            alt="Projection Mapping Example 3" 
            className="service-image" 
          />
          <p>Immersive 3D Mapping</p>
        </div>
      </div>

      <div className="social-icons fade-in m-4 p-4">
        <a href="https://facebook.com" target="_blank" rel="noopener noreferrer"><FaFacebook size={30} /></a>
        <a href="https://instagram.com" target="_blank" rel="noopener noreferrer"><FaInstagram size={30} /></a>
        <a href="https://whatsapp.com" target="_blank" rel="noopener noreferrer"><FaWhatsapp size={30} /></a>
        <a href="https://twitter.com" target="_blank" rel="noopener noreferrer"><FaTwitter size={30} /></a>
        <a href="https://github.com" target="_blank" rel="noopener noreferrer"><FaGithub size={30} /></a>
        <a href="https://linkedin.com" target="_blank" rel="noopener noreferrer"><FaLinkedin size={30} /></a>
        <a href="https://google.com" target="_blank" rel="noopener noreferrer"><FaGoogle size={30} /></a>
      </div>
    </div>
  );
};

export default Services;
