import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot,
  faBrain,
  faSearch,
  faGem,
  faCommentDots,
} from '@fortawesome/free-solid-svg-icons';
import { faXTwitter } from '@fortawesome/free-brands-svg-icons'; // Correct import
import { motion } from "framer-motion";
import "../../styles/PostBoard.css";

const AITools = () => {

  const aiOptions = [
    { icon: faRobot, label: "ChatGPT", link: "https://chatgpt.com/" },
    { icon: faBrain, label: "DeepSeek", link: "https://chat.deepseek.com/" },
    { icon: faSearch, label: "Phind", link: "https://www.phind.com/" },
    { icon: faGem, label: "Gemini", link: "https://gemini.google.com/app" },
    { icon: faCommentDots, label: "Claude", link: "https://claude.ai/new" },
    { icon: faXTwitter, label: "Grok (xAI)", link: "https://x.ai/" },
  ];
  
  const AICircleSelection = () => {
    return (
      <>
       <h1>AI Catalog</h1>
       <div className="circle-container">
        <p>Select your tool of choice.</p>
        {aiOptions.map((option, index) => {
          const angle = (index / aiOptions.length) * 360;
          return (
            <motion.a
              key={option.label}
              href={option.link}
              target="_blank"
              rel="noopener noreferrer"
              className="circle-button"
              style={{ transform: `rotate(${angle}deg) translate(230px) rotate(-${angle}deg)` }}
              whileHover={{transform: `rotate(${angle}deg) translate(200px) rotate(-${angle + 360}deg)` }}
              title={option.label}
            >
              <FontAwesomeIcon icon={option.icon} size="1x" />
              &nbsp;&nbsp;
              <p className="circle-text"> {option.label}</p> 
            </motion.a>
            );
          })}
        </div>
      </>
    );
  };

  return (
    <div className='AITools'>
      {AICircleSelection()}
    </div>
  );

}

export default AITools;
