import React from 'react';
import '../../styles/ReimonTube.css';

const ReimonTube = () => {
  return (
    <>
      <h1 className="top-title"> ReimonTube </h1>
      <div id="ReimonTube" className="video-container">
        {videos.map((videoSrc) => (
          <div key={videoSrc} className="video-item">
            <video controls>
              <source src={videoSrc} type="video/mp4" />
            </video>
          </div>
        ))}
      </div>
    </>
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
