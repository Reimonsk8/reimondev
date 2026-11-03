import { useEffect } from 'react';

import CloseButton from './CloseButton';

interface PlayerProfileCardProps {
    playerId: string;
    nickname: string;
    avatarColor?: string;
    onClose: () => void;
}

export default function PlayerProfileCard({
    playerId: _playerId,
    nickname,
    avatarColor = '#ff6b6b',
    onClose
}: PlayerProfileCardProps) {
    // Handle ESC key to close
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const getInitials = (name: string): string => {
        const parts = name.trim().split(' ');
        if (parts.length >= 2) {
            return (parts[0][0] + parts[1][0]).toUpperCase();
        }
        return name.substring(0, 2).toUpperCase();
    };

    return (
        <div
            className="player-profile-overlay"
            onClick={onClose}
            style={{
                position: 'fixed',
                top: 0,
                left: 0,
                right: 0,
                bottom: 0,
                background: 'rgba(4, 6, 14, 0.72)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                zIndex: 1000,
                backdropFilter: 'blur(6px)',
            }}
        >
            <div
                className="player-profile-card"
                onClick={(e) => e.stopPropagation()}
                style={{
                    minWidth: '380px',
                    maxWidth: '450px',
                }}
            >
                {/* Close Button */}
                {/* Close Button */}
                <CloseButton
                    onClick={onClose}
                    className="absolute top-4 right-4"
                />

                {/* Player Header */}
                <div style={{
                    display: 'flex',
                    alignItems: 'center',
                    gap: '20px',
                    marginBottom: '25px',
                    paddingBottom: '20px',
                    borderBottom: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    {/* Avatar */}
                    <div style={{
                        width: '80px',
                        height: '80px',
                        borderRadius: '50%',
                        background: avatarColor,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: '28px',
                        fontWeight: 'bold',
                        color: '#fff',
                        boxShadow: `0 0 20px ${avatarColor}40`,
                        border: '3px solid rgba(255, 255, 255, 0.2)',
                    }}>
                        {getInitials(nickname)}
                    </div>

                    <div>
                        <h2 style={{
                            margin: 0,
                            fontSize: '24px',
                            color: '#fff',
                            marginBottom: '5px'
                        }}>
                            {nickname}
                        </h2>
                        <p style={{
                            margin: 0,
                            color: '#4ecdc4',
                            fontSize: '14px',
                            display: 'flex',
                            alignItems: 'center',
                            gap: '5px'
                        }}>
                            <span style={{
                                width: '8px',
                                height: '8px',
                                borderRadius: '50%',
                                background: '#4ecdc4',
                                display: 'inline-block',
                            }} />
                            Online
                        </p>
                    </div>
                </div>

                {/* Stats */}
                <div style={{
                    textAlign: 'center',
                    padding: '30px 0',
                    color: '#888',
                    fontSize: '14px',
                }}>
                    Stats are not available yet.
                </div>

                {/* Footer */}
                <div style={{
                    marginTop: '25px',
                    textAlign: 'center',
                    paddingTop: '20px',
                    borderTop: '1px solid rgba(255, 255, 255, 0.1)'
                }}>
                    <p style={{ color: '#666', fontSize: '12px', margin: 0 }}>
                        Press ESC or click outside to close
                    </p>
                </div>
            </div>
        </div>
    );
}
