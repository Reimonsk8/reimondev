import React, { useState } from 'react';
import '../../styles/Resume.css';

const RESUMES = [
  {
    id: 'full-stack',
    label: 'Full-stack & DevOps',
    focus: 'Web development · Cloud infrastructure · Delivery',
    url: 'https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+FullStack+DevOps.pdf',
  },
  {
    id: 'ai-ml',
    label: 'AI/ML & Data Engineering',
    focus: 'Machine learning · Data systems · Applied AI',
    url: 'https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-AI_ML+Data+Engineer.pdf',
  },
  {
    id: 'game-development',
    label: 'C++ & Game Development',
    focus: 'C++ · Unreal Engine · Interactive systems',
    url: 'https://s3.us-east-1.amazonaws.com/reimondev.com/Resume+Jose+Ramon+Gomez+Armenta+2024+-+C%2B%2B+Game+Developer+Unreal+Engine.pdf',
  },
];

export default function Resume() {
  const [selectedId, setSelectedId] = useState(RESUMES[0].id);
  const selectedResume = RESUMES.find((resume) => resume.id === selectedId) || RESUMES[0];

  return (
    <main className="resume-page" aria-labelledby="resume-title">
      <header className="resume-intro">
        <p className="resume-eyebrow">CAREER PROFILE · CURRICULUM VITAE</p>
        <h1 id="resume-title">A career built across disciplines.<br /><span>Focused for what comes next.</span></h1>
        <p className="resume-lede">
          Explore a version tailored to the role—from full-stack and cloud work to AI, data, and game development.
        </p>
      </header>

      <section className="resume-library" aria-labelledby="resume-library-title">
        <div className="resume-section-heading">
          <div>
            <p className="resume-eyebrow">THREE PROFESSIONAL PROFILES</p>
            <h2 id="resume-library-title">Choose a resume</h2>
          </div>
          <a
            className="resume-open-link"
            href={selectedResume.url}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open PDF <span aria-hidden="true">↗</span>
          </a>
        </div>

        <div className="resume-options" role="group" aria-label="Choose a resume to preview">
          {RESUMES.map((resume, index) => {
            const isSelected = resume.id === selectedResume.id;
            return (
              <button
                className={`resume-option${isSelected ? ' is-selected' : ''}`}
                key={resume.id}
                type="button"
                aria-pressed={isSelected}
                onClick={() => setSelectedId(resume.id)}
              >
                <span className="resume-option-number">0{index + 1}</span>
                <span className="resume-option-copy">
                  <strong>{resume.label}</strong>
                  <small>{resume.focus}</small>
                </span>
                <span className="resume-option-state" aria-hidden="true">
                  {isSelected ? 'Selected' : 'Preview'}
                </span>
              </button>
            );
          })}
        </div>

        <div className="resume-preview" aria-label={`${selectedResume.label} PDF preview`}>
          <iframe
            key={selectedResume.id}
            src={`${selectedResume.url}#view=FitH`}
            title={`${selectedResume.label} resume PDF`}
          />
          <p className="resume-preview-fallback">
            Having trouble viewing the document?{' '}
            <a href={selectedResume.url} target="_blank" rel="noopener noreferrer">Open the PDF in a new tab</a>.
          </p>
        </div>
      </section>
      <p className="resume-footer">THANK YOU FOR TAKING THE TIME TO REVIEW MY WORK.</p>
    </main>
  );
}
