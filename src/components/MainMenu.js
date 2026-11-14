import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import '../styles/EclipseTheme.css';
import NavBar from './Navbar';
import { AuthProvider } from '../auth/AuthContext';

// Route-level code splitting: only the landing page is in the initial bundle.
const Home = lazy(() => import('./pages/Home'));
// The intro is opt-in only, so keep its particle engine out of the initial bundle.
const Welcome = lazy(() => import('./Welcome'));
const Services = lazy(() => import('./pages/Services'));
const Resume = lazy(() => import('./pages/Resume'));
const Projects = lazy(() => import('./pages/Projects'));
const PostBoard = lazy(() => import('./pages/PostBoard'));
const SupportMe = lazy(() => import('./pages/SupportMe'));
const Login = lazy(() => import('./pages/Login'));
const Admin = lazy(() => import('./pages/Admin'));
const ReimonTube = lazy(() => import('./pages/ReimonTube'));
const AITools = lazy(() => import('./pages/AITools'));
const IntroKartel = lazy(() => import('./projectPages/IntroKartel'));
const ShopKartel = lazy(() => import('./projectPages/ShopKartel'));

// Suspense fallback while a route chunk loads. The wordmark holds the layout
// still and the line underneath keeps moving, so a slow chunk never flashes a
// bare "Loading…" across the screen.
const RouteFallback = () => (
    <div className="page-loading" role="status" aria-label="Loading">
        <span className="page-loading-mark">REIMON<span>DEV</span></span>
        <span className="page-loading-line" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
    </div>
);

const MainMenu = () => {
    const [showNavbar, setShowNavBar] = useState(true);
    const location = useLocation();

    useEffect(() => {
        setShowNavBar(location.pathname !== '/intro');
    }, [location.pathname]);

    return (
        <>
            {showNavbar && <NavBar />}
            {/* Keyed by history entry: a fresh node on every navigation, so the
                dip-to-dark replays even when the path stays the same. */}
            <div key={location.key} className="route-veil" aria-hidden="true" />
            <Suspense fallback={<RouteFallback />}>
                <Routes>
                    <Route path='/' element={<Home />} />
                    <Route path='/home' element={<Home />} />
                    <Route path='/intro' element={<Welcome />} />
                    <Route path='/services' element={<Services />} />
                    <Route path='/resume' element={<Resume />} />
                    <Route path='/kartel' element={<IntroKartel />} />
                    <Route path='/kartelshop' element={<ShopKartel />} />
                    <Route path='/aitools' element={<AITools />} />
                    <Route path='/projects' element={<Projects />} />
                    <Route path='/postboard' element={<PostBoard />} />
                    <Route path='/reimontube' element={<ReimonTube />} />
                    <Route path='/supportme' element={<SupportMe />} />
                    <Route path='/login' element={<Login />} />
                    <Route path='/admin' element={<Admin />} />
                </Routes>
            </Suspense>
        </>
    );
}

const App = () => (
    <BrowserRouter>
        <AuthProvider>
            <MainMenu />
        </AuthProvider>
    </BrowserRouter>
);

export default App;
