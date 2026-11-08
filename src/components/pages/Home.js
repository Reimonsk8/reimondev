import React from 'react';
import { Link } from 'react-router-dom';
import {
  FaFacebook,
  FaInstagram,
  FaWhatsapp,
  FaGithub,
  FaLinkedin,
} from 'react-icons/fa';
import { FaXTwitter } from 'react-icons/fa6';
import SwordEmblem from '../../assets/reimon-ornate-sword.svg';

const SOCIAL_LINKS = [
  { label: 'GitHub', href: 'https://github.com/Reimonsk8', Icon: FaGithub },
  { label: 'Twitter / X', href: 'https://twitter.com/reimonsk8', Icon: FaXTwitter },
  { label: 'LinkedIn', href: 'https://www.linkedin.com/in/reimondev/', Icon: FaLinkedin },
  { label: 'Facebook', href: 'https://www.facebook.com/reimonsk8', Icon: FaFacebook },
  { label: 'Instagram', href: 'https://www.instagram.com/reimonsk8/', Icon: FaInstagram },
  { label: 'WhatsApp', href: 'https://wa.me/+1234567890', Icon: FaWhatsapp },
];

const Home = () => {
  return (
    <main className="home home-landing" aria-labelledby="home-title">
      <section className="home-hero">
        <div className="sword-showcase" aria-hidden="true">
          <img className="sword-emblem" src={SwordEmblem} alt="" />
        </div>
        <h1 className="home-title" id="home-title">REIMON DEVELOPMENT</h1>
        <p className="home-intro">Testing new stuff, more features coming soon.</p>
        <div className="home-actions">
          <Link className="home-action home-action-primary" to="/projects">Explore work</Link>
          <Link className="home-action" to="/">Replay intro</Link>
        </div>
        <div className="home-social-block">
          <p className="home-social-label">Find me elsewhere</p>
          <nav className="social-icons" aria-label="Social networks">
            {SOCIAL_LINKS.map(({ label, href, Icon }) => (
              <a key={label} href={href} aria-label={label} title={label} target="_blank" rel="noopener noreferrer">
                <Icon aria-hidden="true" />
              </a>
            ))}
          </nav>
        </div>
      </section>
    </main>
  );
};

export default Home;
