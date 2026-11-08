import React, { lazy, Suspense, useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import '../styles/EclipseTheme.css';
import NavBar from './Navbar';
import Welcome from './Welcome';

// Route-level code splitting: only the landing page is in the initial bundle.
const Home = lazy(() => import('./pages/Home'));
const Services = lazy(() => import('./pages/Services'));
const Resume = lazy(() => import('./pages/Resume'));
const Projects = lazy(() => import('./pages/Projects'));
const PostBoard = lazy(() => import('./pages/PostBoard'));
const SupportMe = lazy(() => import('./pages/SupportMe'));
const ReimonTube = lazy(() => import('./pages/ReimonTube'));
const AITools = lazy(() => import('./pages/AITools'));
const IntroKartel = lazy(() => import('./projectPages/IntroKartel'));
const ShopKartel = lazy(() => import('./projectPages/ShopKartel'));

const MainMenu = () => {
    const [showNavbar, setShowNavBar] = useState(true);
    const location = useLocation();

    useEffect(() => {
        setShowNavBar(location.pathname !== '/');
    }, [location.pathname]);

    return (
        <>
            {showNavbar && <NavBar />}
            <Suspense fallback={<div className="page-loading" role="status">Loading…</div>}>
                <Routes>
                    <Route path='/' element={<Welcome />} />
                    <Route path='/home' element={<Home />} />
                    <Route path='/services' element={<Services />} />
                    <Route path='/resume' element={<Resume />} />
                    <Route path='/kartel' element={<IntroKartel />} />
                    <Route path='/kartelshop' element={<ShopKartel />} />
                    <Route path='/aitools' element={<AITools />} />
                    <Route path='/projects' element={<Projects />} />
                    <Route path='/postboard' element={<PostBoard />} />
                    <Route path='/reimontube' element={<ReimonTube />} />
                    <Route path='/supportme' element={<SupportMe />} />
                </Routes>
            </Suspense>
        </>
    );
}

const App = () => (
    <BrowserRouter>
        <MainMenu />
    </BrowserRouter>
);

export default App;
