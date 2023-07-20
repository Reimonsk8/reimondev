
import React, { useEffect } from 'react';

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
      <div>
        
      </div>
    </div>
  );
}
export default Home;