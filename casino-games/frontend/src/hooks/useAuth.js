import { useState, useEffect } from 'react';
import { PREVIEW } from '../utils/preview';

export function useAuth() {
    const [user, setUser] = useState({
        email: '',
        sub: '',
        nickname: 'Player',
        picture: '',
    });
    const [userId, setUserId] = useState(null);
    const [isAuthReady, setIsAuthReady] = useState(false);

    useEffect(() => {
        // Check if user has valid tokens in localStorage
        const idToken = localStorage.getItem('c888_id_token');

        if (PREVIEW) {
            // Dev-only `?preview=1` session — see utils/preview.js.
            setUserId('preview-user');
            setUser({
                email: 'preview@gloom.local',
                sub: 'preview-user',
                nickname: 'Preview Player',
                picture: '',
            });
        } else if (idToken) {
            try {
                // Parse JWT ID token to get user info
                const payload = JSON.parse(atob(idToken.split('.')[1]));

                setUserId(payload.sub);
                setUser({
                    email: payload.email || '',
                    sub: payload.sub || '',
                    nickname: payload.name || (payload.email ? payload.email.split('@')[0] : 'Player'),
                    picture: payload.picture || '',
                });
                console.log("Auth restored from tokens. UID:", payload.sub);
            } catch (err) {
                console.error("Failed to parse token:", err);
                // Clear invalid tokens
                localStorage.removeItem('c888_access_token');
                localStorage.removeItem('c888_id_token');
            }
        }

        setIsAuthReady(true);
    }, []);

    return {
        user,
        setUser,
        userId,
        setUserId,
        isAuthReady,
    };
}
