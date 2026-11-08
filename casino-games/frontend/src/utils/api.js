import { PREVIEW, PREVIEW_DATA } from './preview';

export const API_BASE =
  import.meta.env.VITE_API_URL ||
  "https://pmeyof3qzi.execute-api.us-east-2.amazonaws.com/prod";

/**
 * @param {string} path
 * @param {string} [method]
 * @param {unknown} [body]
 * @param {boolean} [useAuth]
 */
export async function apiCall(path, method = "GET", body = null, useAuth = false) {
    // Dev preview has no Cognito session: answer locally instead of letting the
    // 401 handler below kick the reviewer back to the login page.
    if (PREVIEW) return PREVIEW_DATA[path] ?? {};

    const headers = { "Content-Type": "application/json" };
    if (useAuth) {
        const idToken = localStorage.getItem('c888_id_token') || '';
        const accessToken = localStorage.getItem('c888_access_token') || '';
        const token = idToken || accessToken;
        if (!token) throw new Error("No Access Token guardado. Por favor, inicie sesión.");
        headers["Authorization"] = "Bearer " + token;
    }

    // Simple exponential backoff retry mechanism
    for (let i = 0; i < 3; i++) {
        try {
            const res = await fetch(API_BASE + path, {
                method,
                headers,
                body: body ? JSON.stringify(body) : undefined,
            });

            const text = await res.text();
            let json;
            try { json = JSON.parse(text); } catch { json = { raw: text }; }

            // Check for 401 Unauthorized (JWT expired) only for authenticated requests
            if (res.status === 401 && useAuth) {
                console.warn('JWT token expired or invalid - logging out user');
                // Clear all auth tokens
                localStorage.removeItem('c888_id_token');
                localStorage.removeItem('c888_access_token');
                localStorage.removeItem('c888_refresh_token');
                localStorage.removeItem('c888_user_id');
                // Redirect to login page
                window.location.href = '/';
                const err = new Error("Session expired. Please log in again.");
                err.response = json;
                err.statusCode = 401;
                throw err;
            }

            if (!res.ok) {
                const err = new Error(json.error || json.message || "Request failed");
                err.response = json;
                err.statusCode = res.status;
                throw err;
            }
            return json;
        } catch (error) {
            // Don't retry on 401 - user is being logged out
            if (error.statusCode === 401) {
                throw error;
            }

            if (i < 2 && error.message.includes('Failed to fetch')) {
                await new Promise(resolve => setTimeout(resolve, Math.pow(2, i) * 1000));
            } else {
                throw error;
            }
        }
    }
}
