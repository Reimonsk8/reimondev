import React, { useState } from 'react';
import '../../styles/ReimonTube.css';
import { PixelStreamingWrapper } from "../PixelStreamingWrapper";

//201.171.78.239
//default ws://127.0.0.1:8888
const ReimonTube = () => {

  const [showBroadcast, setShowBroadcast] = useState(false);

  return (
    <div className="reimon-tube-page">
      <div className="top-title"> 
        <h1>ReimonTube </h1>
        <div className='download-button' onClick={()=> setShowBroadcast(!showBroadcast)}>
          {!showBroadcast ? "Show Broadcast" : "Show Videos"}
        </div>
      </div>



      <div id="ReimonTube" className="rt-video-container">
        <br/>
        <br/>
        {showBroadcast ?
          <>
            <div className="bg-filler"></div>
            <PixelStreamingWrapper
            initialSettings={{
                AutoPlayVideo: true,
                AutoConnect: true,
                ss: 'ws://192.168.1.69',
                StartVideoMuted: true,
                HoveringMouse: true,
                WaitForStreamer: true
            }}/>
          </>
          :
          <>
            {videos.map((videoSrc) => (
            <div key={videoSrc} className="rt-video-item">
              <video controls>
                <source src={videoSrc} type="video/mp4" />
              </video>
            </div>
          ))}
          </>
        }
      </div>
    </div>
  );
};

// Define an array of video sources for easier management
const videos = [
  "https://d2e4yr7vi9dx5d.cloudfront.net/New%20video.mp4",
  "https://d2e4yr7vi9dx5d.cloudfront.net/MORDHAU 2023.05.22 - 00.15.26.06.DVR.mp4",
  // "https://d2e4yr7vi9dx5d.cloudfront.net/Dungeoncrawler 2023.02.15 - 22.59.50.03.mp4",
  "https://my-video-storage-demo.s3.amazonaws.com/Session+2022.12.18+-+21.17.16.01.mp4"
];

export default ReimonTube;
