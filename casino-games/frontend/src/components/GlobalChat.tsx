import React, { useState, useEffect, useRef } from 'react';
import CloseButton from './CloseButton';

interface Message {
    id: string;
    sender: string;
    text: string;
    type: 'system' | 'user' | 'win' | 'chat';
    timestamp: number;
}

interface GlobalChatProps {
    isOpen: boolean;
    onClose: () => void;
    nickname: string;
    messages: Message[];
    onSendMessage: (text: string) => void;
}

export default function GlobalChat({ isOpen, onClose, nickname, messages, onSendMessage }: GlobalChatProps) {
    const [inputValue, setInputValue] = useState('');
    const messagesEndRef = useRef<HTMLDivElement>(null);
    const inputRef = useRef<HTMLInputElement>(null);

    // Auto-scroll to bottom
    useEffect(() => {
        if (isOpen && messagesEndRef.current) {
            messagesEndRef.current.scrollIntoView({ behavior: 'smooth' });
        }
    }, [messages, isOpen]);

    // Auto-focus input when opened
    useEffect(() => {
        if (isOpen && inputRef.current) {
            // Small timeout to allow animation/mount to complete
            setTimeout(() => {
                inputRef.current?.focus();
            }, 50);
        }
    }, [isOpen]);

    // Close on Escape
    useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                onClose();
            }
        };
        window.addEventListener('keydown', handleKeyDown);
        return () => window.removeEventListener('keydown', handleKeyDown);
    }, [onClose]);

    const handleSendMessage = (e: React.FormEvent) => {
        e.preventDefault();
        if (!inputValue.trim()) return;

        onSendMessage(inputValue.trim());
        setInputValue('');
    };

    if (!isOpen) return null;

    return (
        <div
            className="custom-container-chat fixed bottom-6 left-6 w-[380px] h-[450px] z-[2000] flex flex-col rounded-2xl overflow-hidden animate-in fade-in slide-in-from-bottom-5 duration-300 ring-1 ring-white/5"
            style={{ animation: 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1)' }}
        >
            {/* Header - Premium Glass */}
            <div className="bg-gradient-to-r from-white/5 to-transparent p-4 flex justify-between items-center border-b border-white/10 shrink-0">
                <div className="flex items-center gap-3">
                    <div className="w-2.5 h-2.5 rounded-full bg-green-500 shadow-[0_0_8px_rgba(34,197,94,0.5)] animate-pulse" />
                    <span className="font-bold text-white tracking-wide text-sm">LOBBY CHAT</span>
                </div>
                <CloseButton
                    onClick={onClose}
                    title="Close Chat (ESC)"
                />
            </div>

            {/* Messages Area - Clean & Readable */}
            <div className="flex-1 overflow-y-auto p-4 space-y-4 custom-scrollbar">
                {messages.map((msg) => {
                    const senderName = msg.sender || (msg as any).nickname || 'Unknown';
                    const msgType = msg.type === 'chat' ? 'user' : msg.type;
                    const isMe = senderName === nickname;

                    return (
                        <div key={msg.id || (msg as any).timestamp} className={`flex flex-col animate-in fade-in duration-200 ${msgType === 'system' ? 'items-center my-4' : 'items-start'}`}>
                            {msgType === 'system' ? (
                                <div className="flex items-center gap-2 px-3 py-1 rounded-full bg-white/5 border border-white/5">
                                    <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
                                    <span className="text-[10px] text-gray-300 font-bold uppercase tracking-wider">
                                        {msg.text || (msg as any).message}
                                    </span>
                                </div>
                            ) : msgType === 'win' ? (
                                <div className="w-full relative group">
                                    <div className="absolute inset-0 bg-gradient-to-r from-yellow-500/20 to-transparent blur-md opacity-50"></div>
                                    <div className="relative bg-gradient-to-r from-yellow-900/40 to-transparent border-l-2 border-yellow-500 pl-3 py-2 rounded-r">
                                        <div className="flex items-center gap-2">
                                            <span className="text-yellow-500 font-bold text-xs uppercase tracking-wider">BIG WIN</span>
                                            <span className="text-gray-400 text-[10px]">• {senderName}</span>
                                        </div>
                                        <div className="text-yellow-100 text-sm font-medium mt-0.5">
                                            {msg.text || (msg as any).message}
                                        </div>
                                    </div>
                                </div>
                            ) : (
                                <div className="group w-full hover:bg-white/[0.02] -mx-2 px-2 py-1 rounded transition-colors">
                                    <div className="flex items-baseline gap-2 mb-0.5">
                                        <span className={`text-xs font-bold ${isMe ? 'text-blue-400' : 'text-gray-300'}`}>
                                            {isMe ? 'You' : senderName}
                                        </span>
                                        <span className="text-[10px] text-gray-600 font-mono">
                                            {new Date(msg.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                                        </span>
                                    </div>
                                    <p className={`text-sm leading-relaxed ${isMe ? 'text-white' : 'text-gray-200'}`}>
                                        {msg.text || (msg as any).message}
                                    </p>
                                </div>
                            )}
                        </div>
                    );
                })}
                <div ref={messagesEndRef} />
            </div>

            {/* Input Area - Integrated */}
            <div className="p-4 pt-2 bg-transparent shrink-0">
                <form
                    onSubmit={handleSendMessage}
                    className="relative flex gap-2"
                >
                    <input
                        ref={inputRef}
                        type="text"
                        value={inputValue}
                        onChange={(e) => setInputValue(e.target.value)}
                        placeholder="Type a message..."
                        className="flex-1 bg-black/40 border border-white/10 rounded-xl px-4 py-3 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-blue-500/50 focus:bg-black/60 focus:ring-1 focus:ring-blue-500/20 transition-all"
                        style={{ color: 'white' }}
                    />
                    <button
                        type="submit"
                        disabled={!inputValue.trim()}
                        className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-bold text-sm disabled:opacity-50 disabled:cursor-not-allowed transition-all shadow-lg shadow-blue-500/20"
                    >
                        SEND
                    </button>
                </form>
            </div>
        </div>
    );
}
