
import React, { useEffect } from 'react';
import { FontAwesomeIcon } from "@fortawesome/react-fontawesome";
import { faFacebook, faInstagram, faWhatsapp, faTwitter, faGithub, faLinkedinIn, faGoogle } from '@fortawesome/free-brands-svg-icons';


const Home = ({setShowNavBar}) =>{

  useEffect(() => {
    setShowNavBar(true);
    // eslint-disable-next-line
  },[])

  return (
    <div className='home'>
      <h1>Home</h1>
      <p>WELCOME</p>
      {/* <img src="https://www.seekpng.com/png/full/259-2598162_page-in-under-construction.png"></img> */}
      <p>Reimon <code> Testing </code> new stuff, more features coming soon</p>


      <p className="App-link">Contact me on my Social networks</p>
       {/* <a href="https://www.sololearn.com/profile/4381706">solo learn</a> */}
      <div className="flex-center">

       <a href="mailto:reimonsk8@gmail.com?subject=Hello&body=This is the body of the email.">
          <i className="fa fa-2x"><FontAwesomeIcon className='icon-3d' icon={faGoogle} /></i>
        </a>

        <a href="https://github.com/Reimonsk8">
          <i className="fa fa-2x"><FontAwesomeIcon className='icon-3d' icon={faGithub} /></i>
        </a>

        <a href="https://twitter.com/reimonsk8">
          <i className="fa fa-2x"><FontAwesomeIcon className='icon-3d' icon={faTwitter} /></i>
        </a>

        <a href="https://www.linkedin.com/in/reimondev/">
          <i className="fa fa-2x"><FontAwesomeIcon className='icon-3d' icon={faLinkedinIn} /></i>
        </a>

        {/* <i className="fa fa-instagram fa-4x icon-3d"><FontAwesomeIcon icon={faInstagram} />
        </i>
        <i className="fa fa-whatsapp fa-4x icon-3d"><FontAwesomeIcon icon={faWhatsapp} />
        </i> */}
      </div>

    </div>
  );
}
export default Home;