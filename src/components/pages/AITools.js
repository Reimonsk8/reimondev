import React, { useState } from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faRobot, faBrain, faSearch, faGem,
  faCommentDots, faQuestionCircle, faLightbulb
} from "@fortawesome/free-solid-svg-icons";
import { faXTwitter } from '@fortawesome/free-brands-svg-icons';
import { motion } from "framer-motion";
import "../../styles/PostBoard.css";

const aiOptions = [
  { icon: faRobot, label: "ChatGPT", link: "https://chatgpt.com/" },
  { icon: faBrain, label: "DeepSeek", link: "https://chat.deepseek.com/" },
  { icon: faSearch, label: "Phind", link: "https://www.phind.com/" },
  { icon: faGem, label: "Gemini", link: "https://gemini.google.com/app" },
  { icon: faCommentDots, label: "Claude", link: "https://claude.ai/new" },
  { icon: faXTwitter, label: "Grok (xAI)", link: "https://x.ai/" },
  { icon: faQuestionCircle, label: "Perplexity", link: "https://www.perplexity.ai/" }
];

const aiStats1 = [
  {
    "Tool": "ChatGPT (OpenAI)",
    "Free Access": "✅",
    "Best Model": "GPT-4-turbo (Pro)",
    "Context Length": "128k",
    "File Uploads": "✅",
    "Image Generation": "✅",
    "Image Input": "✅"
  },
  {
    "Tool": "Claude (Anthropic)",
    "Free Access": "✅",
    "Best Model": "Claude 3 Opus",
    "Context Length": "200k",
    "File Uploads": "✅",
    "Image Generation": "❌",
    "Image Input": "✅"
  },
  {
    "Tool": "Gemini (Google)",
    "Free Access": "✅",
    "Best Model": "Gemini 1.5 Pro",
    "Context Length": "1M (Pro*)",
    "File Uploads": "✅",
    "Image Generation": "✅",
    "Image Input": "✅"
  },
  {
    "Tool": "Perplexity AI",
    "Free Access": "✅",
    "Best Model": "Uses GPT-4, Claude, Mistral",
    "Context Length": "~100k",
    "File Uploads": "✅",
    "Image Generation": "❌",
    "Image Input": "✅"
  },
  {
    "Tool": "Phind",
    "Free Access": "✅",
    "Best Model": "GPT-4-turbo",
    "Context Length": "100k+",
    "File Uploads": "✅",
    "Image Generation": "❌",
    "Image Input": "❌"
  },
  {
    "Tool": "DeepSeek",
    "Free Access": "✅",
    "Best Model": "DeepSeek-V2",
    "Context Length": "128k",
    "File Uploads": "✅",
    "Image Generation": "✅",
    "Image Input": "✅"
  },
  {
    "Tool": "Grok (xAI)",
    "Free Access": "✅",
    "Best Model": "Grok-1",
    "Context Length": "~128k",
    "File Uploads": "❌",
    "Image Generation": "❌",
    "Image Input": "❌"
  }
];

const aiStats2 = [
  {
    "Web Access": "✅",
    "Memory / Recall": "✅",
    "Code Interpreter": "✅",
    "Voice I/O": "✅",
    "Speed": "Fast",
    "Source Citations": "❌",
    "Custom Instructions": "✅"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "❌",
    "Voice I/O": "❌",
    "Speed": "Very fast",
    "Source Citations": "❌",
    "Custom Instructions": "❌"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "✅",
    "Voice I/O": "❌",
    "Speed": "Fast",
    "Source Citations": "✅",
    "Custom Instructions": "❌"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "❌",
    "Voice I/O": "❌",
    "Speed": "Very fast",
    "Source Citations": "✅",
    "Custom Instructions": "❌"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "✅",
    "Voice I/O": "❌",
    "Speed": "Very fast",
    "Source Citations": "✅",
    "Custom Instructions": "❌"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "✅",
    "Voice I/O": "❌",
    "Speed": "Very fast",
    "Source Citations": "✅",
    "Custom Instructions": "❌"
  },
  {
    "Web Access": "✅",
    "Memory / Recall": "❌",
    "Code Interpreter": "❌",
    "Voice I/O": "❌",
    "Speed": "Fast",
    "Source Citations": "❌",
    "Custom Instructions": "❌"
  }
];

const AITools = () => {
  const [hoveredTool, setHoveredTool] = useState(null);

  const getStatsForTool = (label, index = 1) => {
    const toolIndex = aiStats1.findIndex(stat => stat.Tool.toLowerCase().includes(label?.toLowerCase()));
    if (toolIndex === -1) return null;

    return index === 2 ? aiStats2[toolIndex] : aiStats1[toolIndex];
  };

  return (
      <div className="circle-container">
        {aiOptions.map((option, index) => {
          const total = aiOptions.length;
          const angle = (index / total) * 2 * Math.PI;
          const radius = 200;
          const x = Math.cos(angle) * radius + 200;
          const y = Math.sin(angle) * radius + 200;

          return (
            <motion.a
              key={option.label}
              href={option.link}
              target="_blank"
              rel="noopener noreferrer"
              className="circle-button"
              style={{ top: y, left: x }}
              onMouseEnter={() => setHoveredTool(option.label)}
              onMouseLeave={() => setHoveredTool(null)}
              title={option.label}
            >
              <FontAwesomeIcon icon={option.icon} size="lg" />
              <div className="circle-text">{option.label}</div>
            </motion.a>
          );
        })}

      {hoveredTool && (
        <div className="ai-stats">
          <h2>{hoveredTool} Stats</h2>
          <table className="ai-table">
            <thead>
              <tr>
                {Object.keys(aiStats1[0]).map((header, i) => (
                  <th key={i}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {Object.values(getStatsForTool(hoveredTool)).map((value, i) => (
                  <td key={i}>{value.toString()}</td>
                ))}
              </tr>
            </tbody>
          </table>
           <table className="ai-table">
            <thead>
              <tr>
                {Object.keys(aiStats2[0]).map((header, i) => (
                  <th key={i}>{header}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              <tr>
                {Object.values(getStatsForTool(hoveredTool,2)).map((value, i) => (
                  <td key={i}>{value.toString()}</td>
                ))}
              </tr>
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
};

export default AITools;
