import React from 'react';

interface CloseButtonProps {
    onClick: () => void;
    className?: string;
    title?: string;
}

export default function CloseButton({ onClick, className = '', title = 'Close' }: CloseButtonProps) {
    // Base styles with subtle initial look
    const baseClasses = "group z-10 bg-black/20 text-white/40 transition-all duration-300 ease-out shrink-0  flex items-center justify-center rounded-full border border-white/5 shadow-sm cursor-pointer";

    // Hover enhancements: darker bg, brighter text, subtle scale, stronger border, and glow
    const hoverClasses = "hover:bg-black/90 hover:text-white hover:border-white/30 hover:scale-110 hover:shadow-lg hover:shadow-white/10";

    const finalClassName = `${baseClasses} ${hoverClasses} ${className}`.trim();

    return (
        <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
            <button
                onClick={onClick}
                className={finalClassName}
                title={title}
                aria-label={title}
            >
                X
            </button>
        </div>
    );
}