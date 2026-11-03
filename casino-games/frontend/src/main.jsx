import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App.jsx'
import ErrorBoundary from './components/ErrorBoundary.jsx'
import './App.css'
import './styles/theme.css'
import './styles/platform-pages.css'
import { publicAsset } from './utils/publicAsset'

if (import.meta.env.PROD && 'serviceWorker' in navigator) {
    window.addEventListener('load', () => {
    navigator.serviceWorker.register(publicAsset('sw.js')).catch(() => { /* PWA is optional */ });
    });
}

ReactDOM.createRoot(document.getElementById('root')).render(
    <React.StrictMode>
        <ErrorBoundary>
            <BrowserRouter basename={import.meta.env.BASE_URL.replace(/\/$/, '') || '/'}>
                <App />
            </BrowserRouter>
        </ErrorBoundary>
    </React.StrictMode>,
)
