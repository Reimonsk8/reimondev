import { useState } from 'react';

export default function CollapsibleCard({ eyebrow, title, defaultOpen = true, children }) {
  const [open, setOpen] = useState(defaultOpen);

  return (
    <div className={`lobby-history-card ${open ? '' : 'is-collapsed'}`}>
      <button
        className="lobby-collapse-btn"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} ${title}`}
      >
        <span className="lobby-collapse-text">
          <span className="eyebrow">{eyebrow}</span>
          <span className="lobby-collapse-title">{title}</span>
        </span>
        <span className={`lobby-collapse-chevron ${open ? 'open' : ''}`}>▾</span>
      </button>
      <div className={`lobby-collapse-body ${open ? 'open' : ''}`}>
        <div className="lobby-collapse-inner">{children}</div>
      </div>
    </div>
  );
}
