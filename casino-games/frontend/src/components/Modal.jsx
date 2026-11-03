import { useEffect, useRef } from 'react';
import CloseButton from './CloseButton';

export default function Modal({ isOpen, onClose, title, body, type = 'info', children, large = false, isGame = false, variant }) {
    const containerRef = useRef(null);

    useEffect(() => {
        if (!isOpen) return undefined;
        containerRef.current?.focus();
        const onKey = (e) => {
            if (e.key === 'Escape') onClose?.();
        };
        document.addEventListener('keydown', onKey);
        return () => document.removeEventListener('keydown', onKey);
    }, [isOpen, onClose]);

    if (!isOpen) return null;

    const isNotification = !isGame && !children;

    // Determine variant for custom styling
    let computedVariant = variant || 'default';
    if (isGame) computedVariant = 'game';
    else if (isNotification) computedVariant = 'notification';

    // Construct dynamic container class
    const overlayClasses = `custom-container custom-container-${computedVariant} ${isNotification ? 'pointer-events-none bg-transparent' : ''}`;

    // Base container styles
    let containerClasses = `shadow-2xl relative transition-transform duration-300 flex flex-col `;

    if (isGame) {
        containerClasses += ' overflow-hidden';
    } else if (isNotification) {
        // Sleek Notification Toast Style
        // Position: Top-Right floating
        containerClasses += ' pointer-events-auto absolute top-24 right-5 w-auto min-w-[280px] max-w-sm z-[9999] overflow-hidden';
    } else {
        containerClasses += '';
    }

    // Position specific styles
    if (!isNotification) {
        containerClasses += ` m-auto ${large ? 'max-w-4xl w-[90%]' : 'max-w-md w-auto'} `;
    }

    // Title color logic
    const titleColorClass =
        type === 'success' ? 'text-green-400' :
            type === 'error' ? 'text-red-400' :
                'text-blue-400';

    const notifAccent =
        type === 'success' ? 'rgba(34, 197, 94, 0.35)' :
            type === 'error' ? 'rgba(239, 68, 68, 0.35)' :
                'rgba(59, 130, 246, 0.35)';

    return (
        <div className={overlayClasses} onClick={!isNotification ? onClose : undefined}>
            {/* Animation Wrapper for Notification */}
            <div
                className={containerClasses}
                ref={containerRef}
                tabIndex={-1}
                role="dialog"
                aria-modal="true"
                aria-label={typeof title === 'string' ? title : undefined}
                onClick={e => e.stopPropagation()}
                style={isNotification ? { animation: 'slideInRight 0.3s cubic-bezier(0.18, 0.89, 0.32, 1.28)', '--notif-accent': notifAccent } : {}}
            >
                {/* Unified Close Button (only for Standard Modals, NOT Games) */}
                {!isNotification && !isGame && (
                    <CloseButton
                        onClick={onClose}
                        className="absolute top-4 right-4 z-50"
                    />
                )}

                {/* Standard Header (if not game and not notification) */}
                {!isGame && !isNotification && title && (
                    <div className="mb-6 pr-12">
                        <h3 className={`text-2xl font-bold ${titleColorClass}`}>{title}</h3>
                    </div>
                )}

                {/* Notification Content Layout */}
                {isNotification ? (
                    <div className="flex items-start gap-3 p-4 relative overflow-hidden w-full">
                        {/* Shimmer effect overlay */}
                        <div className="absolute inset-0 bg-gradient-to-r from-transparent via-white/5 to-transparent skew-x-12 translate-x-[-150%] animate-shimmer pointer-events-none" />



                        {/* Text Content - Allow wrap, better spacing */}
                        <div className="flex-1 min-w-0 pt-0.5">
                            {title && <h4 className={`text-sm font-bold ${titleColorClass} leading-tight mb-1`}>{title}</h4>}
                            <p className="text-xs text-gray-300 leading-snug break-words pr-2 opacity-90 font-medium">
                                {body}
                            </p>
                        </div>

                        {/* Beautiful Close Icon */}
                        <CloseButton
                            onClick={onClose}
                            className="absolute top-2 right-2 z-50"
                        />
                    </div>
                ) : (
                    <>
                        {/* Standard Content */}
                        <div className={`${isGame ? 'overflow-hidden' : 'overflow-y-auto'} flex-1 custom-scrollbar`}>
                            {children ? children : <p className="text-sm text-gray-300 leading-relaxed">{body}</p>}
                        </div>

                        {/* Footer (only for alerts/simple modals that aren't notifications - e.g. traditional alerts) */}
                        {!children && (
                            <div className="mt-6 flex justify-end shrink-0">
                                <button
                                    onClick={onClose}
                                    className="px-6 py-2 bg-accent-gold text-bg-main font-bold rounded-lg hover:bg-yellow-600 transition shadow-lg shadow-accent-gold/20"
                                >
                                    Understood
                                </button>
                            </div>
                        )}
                    </>
                )}
            </div>
            {/* Styles moved to App.css */}
        </div>
    );
}
