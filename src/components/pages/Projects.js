
import React, { useEffect, useState } from 'react';
import "../../styles/Projects.css";

import screenshot0 from "../../res/DarkVoidConsoleScreen0.png"
import screenshot1 from "../../res/DarkVoidConsoleScreen1.png"
import screenshot2 from "../../res/DarkVoidConsoleScreen2.png"



const Projects = ({setShowNavBar}) =>{
  const [currentIndex, setCurrentIndex] = useState(0);

  const images = [
    screenshot0,
    screenshot1,
    screenshot2,
  ];

  useEffect(() => {
    const intervalId = setInterval(() => {
      setCurrentIndex((prevIndex) => 
        prevIndex === images.length - 1 ? 0 : prevIndex + 1
      );
    }, 3000);

    return () => clearInterval(intervalId);
  }, []);

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
        <div className='flex-grid-container'>
          <div>
            <h5>The Uknown Void - UE5 game</h5>
            <p>Unreal engine multiplayer multiplayer horror survival experience</p>
            <p>Content and demo arriving someday</p>
            <div className="container-game-1">

              <div className="video-container">
                <p>Multiplayer demo snippet</p>
                <div key={"https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4"} className="video-item">
                  <video controls>
                    <source src={"https://my-video-storage-demo.s3.amazonaws.com/Multiplayer.mp4"} type="video/mp4" />
                  </video>
                </div>
              </div>

              <div className="video-container">
                <p>Locomotion demo snippet</p>
                <div key={"https://my-video-storage-demo.s3.amplify env removeamazonaws.com/Locomotion.mp4"} className="video-item">
                  <video controls>
                    <source src={"https://my-video-storage-demo.s3.amazonaws.com/Locomotion.mp4"} type="video/mp4" />
                  </video>
                </div>
              </div>
            </div>
            <br/>
          </div>

          <div class="button-container">
            <h5>single page web applications demos</h5>
          
            <a><div onClick={()=> handleLink('/kartel')} className='web-link'>Cap Brand Webiste </div></a>

            <a href="http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/">
              <div class="web-link">Clothing Webiste</div>
            </a>
            <span>content update coming soon..<br/></span>
          </div>

          <div>
            <h5>dark void - C++ Console game</h5>
              content update coming soon..
          </div>

          <div>
            <h5>DnD - C++ Window Application game</h5>
            <div className="slideshow-container">
              <img src={images[currentIndex]} alt={`Slide ${currentIndex + 1}`} className='slideshow-img'/>
            </div>
            <p>Embark on a thrilling adventure through a dark dungeon, 
              navigating treacherous paths and overcoming challenges as you desperately seek the 
              elusive exit. Will you survive the perils within, or will the shadows consume you?
            </p>
            <a href="/DarknessVoidConsoleAlpha.rar" download className="download-button">
              Download
            </a>
          </div>

          <div><h5>PubNub Real Time Temp Plot Script on WebPage</h5>
          content update coming soon..</div>


        {/* dog 911 */}
        {/* AI image folder categorzerir */}
        </div>
      </div>
    </div>
  );
}
export default Projects;