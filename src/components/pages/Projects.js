
import React, { useEffect } from 'react';

const Projects = ({setShowNavBar}) =>{

  useEffect(() => {
    setShowNavBar(true);
    // eslint-disable-next-line
  },[])

  return (
    <div className='Projects'>
      <h1>Projects</h1>
      
      <div className="container">

        <div><h5>The Uknown Void - UE5 game</h5></div>

        <div> <h5>DnD - C++ Window Application game</h5></div>

        <div><h5>dark void - C++ Console game</h5></div>
        
        <div><h5>single page web applications demos</h5></div>

        <div><h5>PubNub Real Time Temp Plot Script on WebPage</h5></div>

      </div>
    </div>
  );
}
export default Projects;