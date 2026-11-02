
import React, { useEffect, useState } from 'react';
import "../../styles/Projects.css";
import ProjectPubnub from '../projectPages/projectPubnub';

const PUBLIC_URL = process.env.PUBLIC_URL;
const screenshot0 = `${PUBLIC_URL}/img/darkvoid-0.webp`;
const screenshot1 = `${PUBLIC_URL}/img/darkvoid-1.webp`;
const screenshot2 = `${PUBLIC_URL}/img/darkvoid-2.webp`;


const Projects = () => {
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

  const handleLink = (path = '/kartel') => {
    window.location.href = path;
  };

  return (
    <div className='Projects'>
      <h1>Projects</h1>


      <div className="container">
        <div className='flex-grid-container'>

          <div>
            <h5>PubNub Real Time Temp Plot Script on WebPage</h5>

            <p style={{ maxWidth: '800px', margin: '0 auto 20px auto', textAlign: 'center', lineHeight: '1.6' }}>
              Developed as a university IoT prototype, this project enables devices like a Raspberry Pi or ESP32 to transmit sensor data via Wi-Fi to a PubNub server for real-time visualization.
            </p>
            <ProjectPubnub />
          </div>

          <div>
            <h3>Dark and Darker Discord Bot and Local Script for AutoClick Ready Queue and Other Features</h3>
            <img src={`${PUBLIC_URL}/img/lobbyready.webp`} style={{ width: "100%" }} loading="lazy" decoding="async" alt="Dark and Darker lobby ready bot screenshot" />
            <p>Make sure to install the bot in your server:</p>
            <a href="https://discord.com/oauth2/authorize?client_id=1107128802578006066" className="download-button">Install Bot Link</a>
            <p>Then download and run the console application, and keep it open for logging:</p>
            <a href="https://my-video-storage-demo.s3.amazonaws.com/DndAutoClickBot.exe" download className="download-button">DndAutoClickBot.exe</a>
            <br /><br />
            <a href="https://my-video-storage-demo.s3.amazonaws.com/DndAutoClickBot.rar" download className="download-button">DndAutoClickBot.rar</a>
            <br /><br />

            <p>Important: Run the auto-click command while in the full screen dark and darker lobby. Otherwise, it may click random things on your main screen.</p>

            <p>GitHub and more features coming soon...</p>
          </div>

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
            <br />
          </div>

          <div class="button-container">
            <h5>single page web applications demos</h5>

            <a><div onClick={() => handleLink('/kartel')} className='web-link'>Cap Brand Webiste </div></a>

            <a href="http://ncaliforniatestbucket.s3-website-us-west-1.amazonaws.com/">
              <div class="web-link">Clothing Webiste</div>
            </a>
            <span>content update coming soon..<br /></span>
          </div>

          <div>
            <h5>dark void - Qt C++  Console game</h5>
            <img src={`${PUBLIC_URL}/img/darkvoid-qt.webp`} style={{ width: "100%" }} loading="lazy" decoding="async" alt="Dark Void Qt console game screenshot" />
            <p>develeoped on Qt a 2D pixel sprite dungeon adventure</p>
            {/* <a href="/DarknessVoidConsoleAlpha.rar" download className="download-button">
              Download
            </a> */}
          </div>

          <div>
            <h5>DnD - C++ Window Application game</h5>
            <div className="slideshow-container">
              <img src={images[currentIndex]} alt={`Slide ${currentIndex + 1}`} className='slideshow-img' loading="lazy" decoding="async" />
            </div>
            <p>Embark on a thrilling adventure through a dark dungeon,
              navigating treacherous paths and overcoming challenges as you desperately seek the
              elusive exit. Will you survive the perils within, or will the shadows consume you?
            </p>
            <a href="https://my-video-storage-demo.s3.amazonaws.com/DarknessVoidConsoleAlpha.rar" download className="download-button">
              Download
            </a>
          </div>

          <div>
            <h5>Hardware Design Internship - Navico</h5>
            <p>
              Professional internship at Navico's hardware design department, focusing on marine navigation equipment (Sonar, GPS, Radar).
            </p>
            <ul style={{ textAlign: 'left', fontSize: '0.9em', paddingLeft: '20px', lineHeight: '1.4' }}>
              <li><strong>Competitor Analysis:</strong> Reverse engineered and analyzed competitor products to improve internal designs.</li>
              <li><strong>Power Systems:</strong> Characterized solar panels to optimize efficiency (80% Voc) and designed Li-ion battery management systems.</li>
              <li><strong>Automated Testing:</strong> Designed a microcontroller-based instrument to automate circuit testing, featuring analog measuring, PWM generation, and data logging to SD/USB.</li>
            </ul>
          </div>




          {/* dog 911 */}
          {/* AI image folder categorzerir */}
        </div>
      </div>
    </div>
  );
}
export default Projects;