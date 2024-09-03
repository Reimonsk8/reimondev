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

const Home = ({ setShowNavBar }) => {
  useEffect(() => {
    setShowNavBar(true);
    // eslint-disable-next-line
  }, []);

  return (
    <div className='home'>
      <h1>Home</h1>
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
