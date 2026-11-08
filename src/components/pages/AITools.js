import React from 'react';
import { FontAwesomeIcon } from '@fortawesome/react-fontawesome';
import {
  faBrain,
  faCode,
  faGem,
  faLightbulb,
  faWind,
} from '@fortawesome/free-solid-svg-icons';
import {
  SiAnthropic,
  SiGithubcopilot,
  SiGooglegemini,
  SiMicrosoft,
  SiOpenai,
  SiPerplexity,
  SiX,
} from 'react-icons/si';
import '../../styles/PostBoard.css';

const AI_TOOLS = [
  {
    name: 'ChatGPT',
    description: 'General-purpose assistant for writing, analysis, and coding.',
    href: 'https://chatgpt.com/',
    brandIcon: SiOpenai,
  },
  {
    name: 'Claude',
    description: 'Assistant for writing, reasoning, and software development.',
    href: 'https://claude.ai/',
    brandIcon: SiAnthropic,
  },
  {
    name: 'Gemini',
    description: 'Google’s AI assistant and multimodal tools.',
    href: 'https://gemini.google.com/app',
    brandIcon: SiGooglegemini,
  },
  {
    name: 'Microsoft Copilot',
    description: 'Microsoft’s everyday assistant for search and productivity.',
    href: 'https://copilot.microsoft.com/',
    brandIcon: SiMicrosoft,
  },
  {
    name: 'GitHub Copilot',
    description: 'AI coding assistance in supported editors and GitHub.',
    href: 'https://github.com/features/copilot',
    brandIcon: SiGithubcopilot,
  },
  {
    name: 'Cursor',
    description: 'An AI-focused code editor for working across a codebase.',
    href: 'https://cursor.com/',
    icon: faCode,
  },
  {
    name: 'Perplexity',
    description: 'Web-focused answers with source links.',
    href: 'https://www.perplexity.ai/',
    brandIcon: SiPerplexity,
  },
  {
    name: 'DeepSeek',
    description: 'Chat and reasoning models from DeepSeek.',
    href: 'https://chat.deepseek.com/',
    icon: faBrain,
  },
  {
    name: 'Grok · xAI',
    description: 'Grok assistant from xAI.',
    href: 'https://grok.com/',
    brandIcon: SiX,
  },
  {
    name: 'Qwen',
    description: 'Chat and models from Alibaba’s Qwen team.',
    href: 'https://chat.qwen.ai/',
    icon: faLightbulb,
  },
  {
    name: 'Le Chat · Mistral',
    description: 'Mistral’s conversational AI assistant.',
    href: 'https://chat.mistral.ai/',
    icon: faWind,
  },
  {
    name: 'MiniMax',
    description: 'Conversational and multimodal AI tools from MiniMax.',
    href: 'https://chat.minimax.io/',
    icon: faGem,
  },
  {
    name: 'Kimi',
    description: 'AI assistant from Moonshot AI for research, writing, and reasoning.',
    href: 'https://www.kimi.com/',
    icon: faLightbulb,
  },
];

const PREFERRED_SETUP = [
  {
    name: 'Windows Terminal',
    description: 'My everyday terminal for PowerShell, shells, and development tools.',
    href: 'https://aka.ms/terminal',
    mark: 'WT',
    category: 'Terminal',
  },
  {
    name: 'Hermes Agent',
    description: 'A personal AI agent for coding and useful workflows.',
    href: 'https://github.com/NousResearch/hermes-agent',
    mark: 'H',
    category: 'Agent',
  },
  {
    name: 'OpenCode',
    description: 'An open-source coding agent for working with projects from the terminal.',
    href: 'https://opencode.ai/',
    mark: 'OC',
    category: 'Coding agent',
  },
  {
    name: '9Router',
    description: 'Route model requests across providers and connect AI coding tools to a unified endpoint.',
    href: 'https://9router.com/',
    mark: '9R',
    category: 'Model routing',
  },
  {
    name: 'My OpenCode commands',
    description: 'Reusable commands and skills I share for OpenCode.',
    href: 'https://github.com/Reimonsk8/opencode-skills/tree/master/.config/opencode/command',
    mark: 'SK',
    category: 'Open source',
  },
];

const WORKFLOW_TOOLS = [
  {
    name: 'Cryptboard Clipboard',
    description: 'A handy clipboard tool for moving text between devices.',
    href: 'https://cryptboard.io/clipboard',
    mark: 'CB',
    category: 'Clipboard',
  },
  {
    name: 'InstaBox Dashboard',
    description: 'Dashboard for managing my InstaBox services.',
    href: 'https://dashboard.instabox.sh/',
    mark: 'IB',
    category: 'Dashboard',
  },
  {
    name: 'GitHub',
    description: 'Repositories, collaboration, issues, and project automation.',
    href: 'https://github.com/',
    mark: 'GH',
    category: 'Code & collaboration',
  },
  {
    name: 'Graphify',
    description: 'Turn code and documents into a searchable knowledge graph, report, and interactive studio.',
    href: 'https://www.npmjs.com/package/@sentropic/graphify',
    mark: 'GF',
    category: 'Codebase exploration',
  },
  {
    name: 'Render',
    description: 'Deploy and host web apps, APIs, and supporting services.',
    href: 'https://dashboard.render.com/',
    mark: 'R',
    category: 'Hosting',
  },
  {
    name: 'Vercel',
    description: 'Frontend deployment and hosting for web projects.',
    href: 'https://vercel.com/',
    mark: 'V',
    category: 'Frontend hosting',
  },
  {
    name: 'GitHub Actions',
    description: 'Automate checks, tests, builds, and deployment from your repositories.',
    href: 'https://github.com/features/actions',
    mark: 'CI',
    category: 'Automation',
  },
  {
    name: 'AWS',
    description: 'Cloud infrastructure, storage, serverless apps, and deployment tools.',
    href: 'https://aws.amazon.com/',
    mark: 'AWS',
    category: 'Cloud',
  },
  {
    name: 'Edgegap',
    description: 'Tools and services for deploying multiplayer game servers.',
    href: 'https://edgegap.com/',
    mark: 'EG',
    category: 'Game hosting',
  },
  {
    name: 'Torlink',
    description: 'Open-source project and networking tools by Baairon.',
    href: 'https://github.com/baairon/torlink',
    mark: 'TL',
    category: 'Open source',
  },
  {
    name: 'BrowserOS Neo · MCP',
    description: 'A browser for agent workflows, including MCP-driven browsing and testing.',
    href: 'https://browseros.com/',
    mark: 'N',
    category: 'Browser automation',
  },
  {
    name: 'StackBlitz',
    description: 'Spin up web experiments and share runnable prototypes in the browser.',
    href: 'https://stackblitz.com/',
    mark: 'SB',
    category: 'Prototyping',
  },
  {
    name: 'Quickliquid Playground',
    description: 'An interactive browser playground for experimenting with Quickliquid.',
    href: 'https://quickliquid.vercel.app/playground/',
    mark: 'QL',
    category: 'Playground',
  },
  {
    name: 'Excalidraw',
    description: 'Quick sketches, diagrams, and early product ideas.',
    href: 'https://excalidraw.com/',
    mark: 'EX',
    category: 'Ideas & diagrams',
  },
  {
    name: 'Bruno',
    description: 'Lightweight API client with collections stored as files in Git.',
    href: 'https://www.usebruno.com/',
    mark: 'B',
    category: 'API testing',
  },
  {
    name: 'DBeaver',
    description: 'Work with PostgreSQL, MySQL, SQLite, MongoDB, and other databases.',
    href: 'https://dbeaver.io/',
    mark: 'DB',
    category: 'Database tools',
  },
  {
    name: 'Redis Insight',
    description: 'Inspect Redis keys and data structures, and monitor performance.',
    href: 'https://redis.io/insight/',
    mark: 'RI',
    category: 'Redis tools',
  },
  {
    name: 'Three.js',
    description: 'Build 3D web experiences and interactive visualizations.',
    href: 'https://threejs.org/',
    mark: '3D',
    category: 'Web graphics',
  },
];

const CREATIVE_TOOLS = [
  {
    name: 'Suno',
    description: 'Create and explore AI-generated music.',
    href: 'https://suno.com/',
    mark: 'S',
    category: 'Music',
  },
  {
    name: 'CapCut',
    description: 'Video editing and creative tools for quick content workflows.',
    href: 'https://www.capcut.com/',
    mark: 'CC',
    category: 'Video editing',
  },
  {
    name: 'Dreamina · Seedance',
    description: 'Explore AI image and video creation, including Seedance where available.',
    href: 'https://dreamina.capcut.com/',
    mark: 'SD',
    category: 'AI video',
  },
  {
    name: 'PixelLab',
    description: 'AI-assisted pixel-art creation for game assets and sprites.',
    href: 'https://www.pixellab.ai/',
    mark: 'PX',
    category: 'Game art',
  },
];

function ResourceSection({ id, title, description, resources }) {
  return (
    <section className="ai-resource-section" aria-labelledby={`${id}-title`}>
      <header className="ai-resource-heading">
        <h3 id={`${id}-title`}>{title}</h3>
        <p>{description}</p>
      </header>
      <div className="ai-tool-grid">
        {resources.map((resource) => {
          const content = (
            <>
              <span className="ai-tool-mark" aria-hidden="true">{resource.mark}</span>
              <span className="ai-tool-copy">
                <small className="ai-tool-category">{resource.category}</small>
                <strong>{resource.name}</strong>
                <small>{resource.description}</small>
              </span>
              {resource.href && <span className="ai-tool-arrow" aria-hidden="true">↗</span>}
            </>
          );

          return resource.href ? (
            <a
              className="ai-tool-card"
              key={resource.name}
              href={resource.href}
              target="_blank"
              rel="noopener noreferrer"
            >
              {content}
            </a>
          ) : (
            <article className="ai-tool-card ai-tool-card--local" key={resource.name}>
              {content}
            </article>
          );
        })}
      </div>
    </section>
  );
}

export default function AITools() {
  return (
    <section className="AITools ai-tools-directory" aria-labelledby="ai-tools-title">
      <header className="ai-tools-heading">
        <p className="postboard-eyebrow">MY EVERYDAY TOOLKIT</p>
        <h2 id="ai-tools-title">AI Tools &amp; Resources</h2>
        <p>A personal launchpad for my development setup, hosting and testing tools, and creative AI services.</p>
      </header>

      <ResourceSection
        id="preferred-setup"
        title="Preferred setup"
        description="My usual flow: Windows Terminal → Hermes Agent → OpenCode, with 9Router handling model routing."
        resources={PREFERRED_SETUP}
      />

      <ResourceSection
        id="workflow-resources"
        title="Developer workflow"
        description="Useful links for building, hosting, testing, prototyping, and keeping everyday work moving."
        resources={WORKFLOW_TOOLS}
      />

      <ResourceSection
        id="creative-tools"
        title="Creative AI tools"
        description="Tools I use or explore for music, video, and game-art ideas. Features and availability may vary by region."
        resources={CREATIVE_TOOLS}
      />

      <section className="ai-resource-section" aria-labelledby="ai-assistants-title">
        <header className="ai-resource-heading">
          <h3 id="ai-assistants-title">AI assistants</h3>
          <p>Shortcuts to general-purpose assistants, research tools, and AI coding products.</p>
        </header>
        <div className="ai-tool-grid">
          {AI_TOOLS.map((tool) => {
            const BrandIcon = tool.brandIcon;
            return (
              <a
                className="ai-tool-card"
                key={tool.name}
                href={tool.href}
                target="_blank"
                rel="noopener noreferrer"
              >
                <span className="ai-tool-mark" aria-hidden="true">
                  {BrandIcon ? <BrandIcon /> : <FontAwesomeIcon icon={tool.icon} />}
                </span>
                <span className="ai-tool-copy">
                  <strong>{tool.name}</strong>
                  <small>{tool.description}</small>
                </span>
                <span className="ai-tool-arrow" aria-hidden="true">↗</span>
              </a>
            );
          })}
        </div>
      </section>

      <p className="ai-tools-note">
        Links open third-party services. Features, availability, and pricing can change; check each provider for current details.
      </p>
    </section>
  );
}
