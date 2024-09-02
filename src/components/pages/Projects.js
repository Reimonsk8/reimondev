
import React, { useEffect } from 'react';
import "../../styles/Projects.css";

const Projects = ({setShowNavBar}) =>{

  useEffect(() => {
    setShowNavBar(true);
    // eslint-disable-next-line
  },[])

  const handleLink = (path = '/kartel') => {
    window.location.href = path;
  };

  return (
    <div className='Projects'>
      <h1>Projects</h1>
      
      <div className="container">

        <div className="game-1">
          <h5>The Uknown Void - UE5 game</h5>
          demo of multiplayer
          <br/>
          <img src="https://my-video-storage-demo.s3.amazonaws.com/demoMultiplayer.gif" width="720px" height="480px" />
          <br/>
          demo of locomotion
          <br/>
          <img src="https://my-video-storage-demo.s3.amazonaws.com/AdvancedLocomotionIntegration.gif" width="720px" height="480px" />
          <br/>
          {/* <h5>The Uknown Void - UE5 game</h5>
          demo of multiplayer
          <br/>
          <video width="720px" height="480px" controls>
            <source src="https://my-video-storage-demo.s3.amazonaws.com/demoMultiplayer.gif" ></source>
          </video>
          <br/>
          demo of locomotion
          <br/>
          <video width="720px" height="480px" controls>
            <source src="https://my-video-storage-demo.s3.amazonaws.com/AdvancedLocomotionIntegration.gif" ></source>
          </video> */}
          <br/>

          content update coming soon..
        </div>

        <div><h5>single page web applications demos</h5>

          <div onClick={()=> handleLink('/kartel')} className='web-link'><h2>Cap Brand Webiste</h2></div>

          <div onClick={()=> handleLink('/twoheads')} className='web-link'><h2>Clothing Webiste</h2></div>

          content update coming soon..
          <br></br>
          <a href="http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/">Cap Brand Webiste</a>
          
        </div>

        <div> <h5>DnD - C++ Window Application game</h5>
         content update coming soon..</div>

        <div><h5>dark void - C++ Console game</h5>
          content update coming soon..</div>
        


        <div><h5>PubNub Real Time Temp Plot Script on WebPage</h5>
         content update coming soon..</div>


      {/* dog 911 */}
      {/* AI image folder categorzerir */}
      </div>
    </div>
  );
}
export default Projects;