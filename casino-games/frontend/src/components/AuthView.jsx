import { useState } from 'react';
import { apiCall } from '../utils/api';
import { googleLoginUrl, COGNITO_CLIENT_ID } from '../utils/oauth';
import { Gamepad2, ShieldCheck, Skull, Spade, Swords } from 'lucide-react';
import { PLATFORM_MARK, PLATFORM_NAME } from '../platform/catalog';

export default function AuthView({ onLoginSuccess, setUser, showModal }) {
    const [authForm, setAuthForm] = useState('login');
    const [loading, setLoading] = useState(false);

    const handleSignUp = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        const password = e.target.password.value.trim();

        if (!email || !password) {
            showModal('Registration Error', 'Email and Password are required.', 'error');
            return;
        }

        setLoading(true);
        try {
            await apiCall('/auth/signup', 'POST', { email, password }, false);
            setUser((prev) => ({ ...prev, email }));
            showModal('Registration Successful', 'Account created! Check your email for the verification code.', 'success');
            setAuthForm('verify');
        } catch (err) {
            showModal('Registration Error', err.response ? err.response.message : err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleVerify = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        const code = e.target.code.value.trim();

        if (!email || !code) {
            showModal('Verification Error', 'Email and Code are required.', 'error');
            return;
        }

        setLoading(true);
        try {
            await apiCall('/auth/verify', 'POST', { email, code }, false);
            showModal('Verification Successful', 'Email verified. You can now log in.', 'success');
            setAuthForm('login');
        } catch (err) {
            showModal('Verification Error', err.response ? err.response.message : err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleForgot = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();

        if (!email) {
            showModal('Reset Error', 'Email is required.', 'error');
            return;
        }

        setLoading(true);
        try {
            await apiCall('/auth/forgot', 'POST', { email }, false);
            showModal('Reset Code Sent', 'Check your email for the password reset code.', 'success');
            setAuthForm('reset');
        } catch (err) {
            showModal('Reset Error', err.response ? err.response.message : err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleReset = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        const code = e.target.code.value.trim();
        const password = e.target.password.value.trim();

        if (!email || !code || !password) {
            showModal('Reset Error', 'Email, Code and Password are required.', 'error');
            return;
        }
        if (password.length < 8) {
            showModal('Reset Error', 'Password must be at least 8 characters.', 'error');
            return;
        }

        setLoading(true);
        try {
            await apiCall('/auth/confirm-forgot-password', 'POST', { email, code, password }, false);
            showModal('Password Reset', 'Password updated. You can now log in.', 'success');
            setAuthForm('login');
        } catch (err) {
            showModal('Reset Error', err.response ? err.response.message : err.message, 'error');
        } finally {
            setLoading(false);
        }
    };

    const handleLogin = async (e) => {
        e.preventDefault();
        const email = e.target.email.value.trim();
        const password = e.target.password.value.trim();

        if (!email || !password) {
            showModal('Login Error', 'Email and Password are required.', 'error');
            return;
        }

        setLoading(true);
        try {
            const result = await apiCall('/auth/login', 'POST', { email, password }, false);
            localStorage.setItem('c888_access_token', result.tokens.AccessToken || '');
            localStorage.setItem('c888_id_token', result.tokens.IdToken || '');

            const idToken = result.tokens.IdToken;
            const payload = JSON.parse(atob(idToken.split('.')[1]));

            setUser({
                email: payload.email || email,
                sub: payload.sub || '',
                nickname: (payload.email || email).split('@')[0] || 'Player',
            });

            showModal('Login Successful', `Welcome back ${email.split('@')[0]}! Loading your Dashboard...`, 'success');
            onLoginSuccess();
        } catch (err) {
            showModal('Login Error', err.message || 'An error occurred during login', 'error');
        } finally {
            setLoading(false);
        }
    };

    const renderForm = () => {
        const inputClass = 'form-input auth-input';
        const labelClass = 'form-label auth-label';
        const isVerify = authForm === 'verify';
        const isSignup = authForm === 'signup';
        const isForgot = authForm === 'forgot';
        const isReset = authForm === 'reset';

        const handler = authForm === 'login' ? handleLogin : isSignup ? handleSignUp : isVerify ? handleVerify : isForgot ? handleForgot : handleReset;

        const emailId = `${authForm}-email`;

        return (
            <form onSubmit={handler} className="container-form auth-form">
                <div className="auth-field">
                    <label className={`${labelClass}`} htmlFor={emailId}>Email</label>
                    <input
                        id={emailId}
                        name="email"
                        type="email"
                        autoComplete="email"
                        className={inputClass}
                        placeholder="youremail@email.com"
                        required
                    />
                </div>
                {isReset && (
                    <>
                        <div className="auth-field">
                            <label className={`${labelClass}`} htmlFor="reset-code">Verification Code</label>
                            <input
                                id="reset-code"
                                name="code"
                                type="text"
                                autoComplete="one-time-code"
                                className={inputClass}
                                placeholder="000000"
                                required
                            />
                        </div>
                    </>
                )}
                {!isForgot && (
                    <>
                        <div className="auth-field">
                            <label className={`${labelClass}`} htmlFor="reset-password">
                                {isVerify ? 'Verification Code' : isSignup || isReset ? 'New Password' : 'Password'}
                            </label>
                            <input
                                id="reset-password"
                                name={isVerify ? 'code' : 'password'}
                                type={isVerify ? 'text' : 'password'}
                                autoComplete={isVerify ? 'one-time-code' : isSignup || isReset ? 'new-password' : 'current-password'}
                                className={inputClass}
                                placeholder={isVerify ? '000000' : 'Minimum 8 characters'}
                                required
                            />
                        </div>
                    </>
                )}

                    <button type="submit" disabled={loading} className="primary-button auth-submit">
                    <span>{loading ? 'Processing...' : authForm === 'login' ? 'Sign in' : isSignup ? 'Create Account' : isVerify ? 'Confirm Code' : isForgot ? 'Send Reset Code' : 'Reset Password'}</span>
                    {authForm === 'login' && !loading && <span aria-hidden="true">→</span>}
                </button>
            </form>
        );
    };

    const title =
        authForm === 'login'
            ? 'Welcome back'
            : authForm === 'signup'
                ? 'Create your account'
                : authForm === 'forgot'
                    ? 'Reset your password'
                    : authForm === 'reset'
                        ? 'Set a new password'
                        : 'Verify your email';
    const subtitle =
        authForm === 'login'
            ? 'One account for every world. Pick up where you left off.'
            : authForm === 'signup'
                ? 'One account unlocks the whole library — no separate sign-ins.'
                : authForm === 'forgot'
                    ? 'Enter your email and we will send you a reset code.'
                    : authForm === 'reset'
                        ? 'Enter the code from your email and choose a new password.'
                        : 'Enter the code sent to your email.';

    return (
        <div className="auth-grid auth-experience">
            <section className="glass-card auth-card" aria-labelledby="auth-title">
                <div className="auth-brand">
                    <span className="gg-brand-mark">{PLATFORM_MARK}</span>
                    <span className="gg-brand-text">
                        <span className="gg-brand-name">{PLATFORM_NAME}</span>
                        <span className="gg-brand-tag">one account · every world</span>
                    </span>
                </div>

                <div className="auth-header">
                    <span className="auth-kicker">Your worlds are waiting</span>
                    <h1 id="auth-title">{title}</h1>
                    <p>{subtitle}</p>
                </div>

                {COGNITO_CLIENT_ID && (authForm === 'login' || authForm === 'signup') && (
                    <div className="w-full flex flex-col items-center gap-4 mb-2">
                        <button
                            type="button"
                            disabled={loading}
                            onClick={() => { window.location.href = googleLoginUrl(); }}
                            className="ghost-button auth-google-button"
                        >
                            <svg width="18" height="18" viewBox="0 0 48 48">                                <path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>
                                <path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>
                                <path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>
                                <path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/>
                            </svg>
                            Continue with Google
                        </button>
                        <div className="auth-divider">
                            <span>or continue with email</span>
                        </div>
                    </div>
                )}

                {renderForm()}
                <div className="auth-switch" aria-live="polite">
                    {authForm === 'login' ? (
                        <>
                            <span>Don't have an account?</span>
                            <button onClick={() => setAuthForm('signup')}>Sign Up</button>
                            <br />
                            <button className="ghost-button" onClick={() => setAuthForm('forgot')}>
                                Forgot password?
                            </button>
                        </>
                    ) : (
                        <>
                            <span>Already have an account?</span>
                            <button onClick={() => setAuthForm('login')}>Log In</button>
                        </>
                    )}
                    {authForm === 'signup' && (
                        <button className="ghost-button" onClick={() => setAuthForm('verify')}>
                            I already have a code
                        </button>
                    )}
                    {authForm === 'verify' && (
                        <button className="ghost-button" onClick={() => setAuthForm('login')}>
                            Back to Login
                        </button>
                    )}
                    {(authForm === 'forgot' || authForm === 'reset') && (
                        <button className="ghost-button" onClick={() => setAuthForm('login')}>
                            Back to Login
                        </button>
                    )}
                </div>
            </section>

            <aside className="auth-highlight glass-card" aria-label="About the game library">
                <div>
                    <span className="auth-kicker">One connected universe</span>
                    <h2>One account.<br />Every world.</h2>
                    <p>
                        A growing collection of distinct games, brought together by one profile and a shared play-money wallet.
                    </p>
                    <br />
                    <p className="auth-quote">
                        "One account. One library. Every game in one place."
                    </p>
                </div>
                <ul className="auth-world-list">
                    <li><Swords size={16} /><span><strong>Square of Shadows</strong> — turn-based tactics</span></li>
                    <li><Skull size={16} /><span><strong>Outlands</strong> — isometric zombie survival</span></li>
                    <li><Spade size={16} /><span><strong>Casino</strong> — live lobby &amp; classic tables</span></li>
                    <li><Gamepad2 size={16} /><span><strong>Arcade</strong> — cabinets &amp; original games</span></li>
                    <li><ShieldCheck size={16} /><span><strong>Play-money</strong> chips only</span></li>
                </ul>
                <p className="auth-footnote"><ShieldCheck size={15} /> Play-money experiences. No real-money wagering.</p>
            </aside>
        </div>
    );
}
