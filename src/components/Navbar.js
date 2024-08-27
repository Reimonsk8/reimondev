  
import React, { useState } from 'react';
import * as FaIcons from 'react-icons/fa';
import * as AiIcons from 'react-icons/ai';
import * as IoIcons from 'react-icons/io';
import { Link } from 'react-router-dom';
import '../styles/Navbar.css';
import { IconContext } from 'react-icons';

function Navbar() {
  const [sidebar, setSidebar] = useState(false);

  const showSidebar = () => setSidebar(!sidebar);

  const SidebarData = [
    {
      title: 'Home',
      path: '/home',
      icon: <AiIcons.AiFillHome />,
      cName: 'nav-text'
    },
    {
      title: 'Resume',
      path: '/resume',
      icon: <IoIcons.IoIosPaper />,
      cName: 'nav-text'
    },
    {
      title: 'Projects',
      path: '/projects',
      icon: <IoIcons.IoMdPeople />,
      cName: 'nav-text'
    },
    // {
    //   title: 'Post Board',
    //   path: '/postboard',
    //   icon: <FaIcons.FaEnvelopeOpenText />,
    //   cName: 'nav-text'
    // },
    {
      title: 'Reimon Tube',
      path: '/reimontube',
      icon: <FaIcons.FaTv/>,
      cName: 'nav-text'
    },
    {
      title: 'Support Me',
      path: '/supportme',
      icon: <FaIcons.FaCartPlus />,
      cName: 'nav-text'
    }
  ];

  return (
    <>
      <IconContext.Provider value={{ color: '#fff' }}>
        <div className='navbar'>
          <Link to='#' className={!sidebar ? 'menu-bars' : 'menu-bars hide'}>
            <FaIcons.FaBars onClick={showSidebar} />
          </Link>
        </div>
        <nav className={sidebar ? 'nav-menu active' : 'nav-menu'}>
          <ul className='nav-menu-items' onClick={showSidebar}>
            <li className='navbar-toggle'>
              <Link to='#' className='menu-bars'>
                <AiIcons.AiOutlineClose />
              </Link>
            </li>
            {SidebarData.map((item, index) => {
              return (
                <li key={index} className={item.cName}>
                  <Link to={item.path}>
                    {item.icon}
                    <span>{item.title}</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
      </IconContext.Provider>
    </>
  );
}

export default Navbar;