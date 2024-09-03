
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
  
  <div className="video-container">
    demo of multiplayer
    <br/>
    <div key={"https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4"} className="video-item">
      <video controls>
        <source src={"https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4"} type="video/mp4" />
      </video>
    </div>
  </div>

  <div className="video-container">
    demo of locomotion
    <br/>
    <div key={"https://my-video-storage-demo.s3.amazonaws.com/Locomotion.mp4"} className="video-item">
      <video controls>
        <source src={"https://my-video-storage-demo.s3.amazonaws.com/Locomotion.mp4"} type="video/mp4" />
      </video>
    </div>
  </div>

          content update coming soon..
        </div>

        <div><h5>single page web applications demos</h5>

          <div onClick={()=> handleLink('/kartel')} className='web-link'><h2>Cap Brand Webiste</h2></div>

          <a href="http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/"><div className='web-link'><h2>Clothing Webiste</h2></div></a>

          content update coming soon..
          <br></br>
          
          
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