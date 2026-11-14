import React, { useEffect, useRef, useState } from 'react';
import * as FaIcons from 'react-icons/fa';
import * as AiIcons from 'react-icons/ai';
import * as IoIcons from 'react-icons/io';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../auth/AuthContext';
import '../styles/Navbar.css';

const NAV_ITEMS = [
  { title: 'Home', path: '/home', icon: <AiIcons.AiFillHome /> },
  { title: 'Resume', path: '/resume', icon: <IoIcons.IoIosPaper /> },
  { title: 'Post Board', path: '/postboard', icon: <FaIcons.FaEnvelopeOpenText /> },
  { title: 'Work', path: '/projects', icon: <FaIcons.FaLayerGroup /> },
  { title: 'Services', path: '/services', icon: <FaIcons.FaBusinessTime /> },
  { title: 'Reimon Tube', path: '/reimontube', icon: <FaIcons.FaTv /> },
  { title: 'Support Me', path: '/supportme', icon: <FaIcons.FaCartPlus /> },
];

function Navbar() {
  const [sidebar, setSidebar] = useState(false);
  const location = useLocation();
  const { user, isAdmin, signOut } = useAuth();
  const triggerRef = useRef(null);
  const closeRef = useRef(null);
  const navigationRef = useRef(null);

  useEffect(() => {
    setSidebar(false);
  }, [location.pathname]);

  useEffect(() => {
    if (!sidebar) return undefined;
    const trigger = triggerRef.current;
    closeRef.current?.focus();
    const handleKeyDown = (event) => {
      if (event.key === 'Escape') {
        setSidebar(false);
        return;
      }

      if (event.key !== 'Tab') return;
      const focusable = navigationRef.current?.querySelectorAll('a[href], button:not([disabled])');
      if (!focusable?.length) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      if (document.body.contains(trigger)) trigger?.focus();
    };
  }, [sidebar]);

  const closeSidebar = () => setSidebar(false);

  const handleSignOut = async () => {
    closeSidebar();
    await signOut();
  };

  return (
    <>
      <header className="navbar">
        <button
          ref={triggerRef}
          type="button"
          className={sidebar ? 'menu-bars is-hidden' : 'menu-bars'}
          aria-label="Open navigation"
          aria-controls="primary-navigation"
          aria-expanded={sidebar}
          onClick={() => setSidebar(true)}
        >
          <FaIcons.FaBars aria-hidden="true" />
        </button>
      </header>

      {sidebar && (
        <button
          type="button"
          className="nav-backdrop"
          aria-label="Close navigation"
          onClick={closeSidebar}
        />
      )}

      <nav
        ref={navigationRef}
        id="primary-navigation"
        className={sidebar ? 'nav-menu is-open' : 'nav-menu'}
        aria-label="Main navigation"
        aria-hidden={!sidebar}
      >
        <div className="nav-menu-header">
          <Link className="nav-wordmark" to="/home" onClick={closeSidebar}>REIMON<span>DEV</span></Link>
          <button ref={closeRef} type="button" className="nav-close" onClick={closeSidebar} aria-label="Close navigation">
            <AiIcons.AiOutlineClose aria-hidden="true" />
          </button>
        </div>
        <ul className="nav-menu-items">
          {NAV_ITEMS.map((item) => {
            const isActive = location.pathname === item.path;
            return (
              <li key={item.path} className="nav-text">
                <Link
                  to={item.path}
                  aria-current={isActive ? 'page' : undefined}
                  onClick={closeSidebar}
                >
                  {item.icon}
                  <span>{item.title}</span>
                </Link>
              </li>
            );
          })}
        </ul>

        {/* Bottom of the menu: account entry, plus the admin console for the
            admin account only. */}
        <div className="nav-auth">
          {isAdmin && (
            <Link
              className="nav-auth-item"
              to="/admin"
              onClick={closeSidebar}
              aria-current={location.pathname === '/admin' ? 'page' : undefined}
            >
              <FaIcons.FaUserShield aria-hidden="true" />
              <span>Admin</span>
            </Link>
          )}
          {user ? (
            <button type="button" className="nav-auth-item" onClick={handleSignOut}>
              <FaIcons.FaSignOutAlt aria-hidden="true" />
              <span>Log out</span>
            </button>
          ) : (
            <Link
              className="nav-auth-item"
              to="/login"
              onClick={closeSidebar}
              aria-current={location.pathname === '/login' ? 'page' : undefined}
            >
              <FaIcons.FaSignInAlt aria-hidden="true" />
              <span>Log in</span>
            </Link>
          )}
        </div>

        <p className="nav-menu-footer">A QUIET PLACE TO BUILD.</p>
      </nav>
    </>
  );
}

export default Navbar;
