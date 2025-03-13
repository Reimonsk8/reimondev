import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes, Route, useLocation } from 'react-router-dom';
import NavBar from './Navbar';
import Welcome from './Welcome';
import Home from './pages/Home';
import Services from './pages/Services';
import Resume from './pages/Resume';
import Projects from './pages/Projects';
import PostBoard from './pages/PostBoard';
import SupportMe from './pages/SupportMe'; 
import ReimonTube from './pages/ReimonTube';
import AITools from './pages/AITools';
import IntroKartel from './projectPages/IntroKartel';
import ShopKartel from './projectPages/ShopKartel';

const createParticleBackground = () => {
    window.particlesJS('particles-js', {
        "particles": {
            "number": {
                "value": 150,
                "density": { "enable": true, "value_area": 500 }
            },
            "color": { "value": "#ffffff" },
            "shape": {
                "type": "circle",
                "stroke": { "width": 0, "color": "#000000" },
                "polygon": { "nb_sides": 5 },
                "image": { "src": "img/github.svg", "width": 100, "height": 100 }
            },
            "opacity": { "value": 0.25, "random": true, "anim": { "enable": false, "speed": 0.5, "opacity_min": 0.1, "sync": false }},
            "size": { "value": 2.5, "random": false, "anim": { "enable": true, "speed": 40, "size_min": 0.1, "sync": false }},
            "line_linked": {
                "enable": true,
                "distance": 100,
                "color": "#ffffff",
                "opacity": 0.4,
                "width": 2
            },
            "move": { "enable": true, "speed": 5, "direction": "none", "random": false, "out_mode": "out", "attract": { "enable": true, "rotateX": 600, "rotateY": 1200 }},
        },
        "interactivity": {
            "detect_on": "canvas",
            "events": { "onhover": { "enable": true, "mode": "repulse" }, "onclick": { "enable": true, "mode": "push" }, "resize": true },
            "modes": { "grab": { "distance": 400, "line_linked": { "opacity": 1 } }, "bubble": { "distance": 400, "size": 40, "duration": 2, "opacity": 8, "speed": 3 }, "repulse": { "distance": 120 }, "push": { "particles_nb": 4 }, "remove": { "particles_nb": 2 }}
        },
        "retina_detect": true
    });
}

const deleteParticleJsDiv = () => {
    let particleJsDiv = document.getElementById('particles-js');
    if (particleJsDiv) particleJsDiv.remove();
    else console.log("Element not found.");
}

const MainMenu = () => {
    const [showNavbar, setShowNavBar] = useState(true);
    const location = useLocation();

    useEffect(() => {
        // showParticles ? createParticleBackground() : deleteParticleJsDiv();
    }, []);

    useEffect(() => {
        const hideNavbarRoutes = ['/'];
        setShowNavBar(!hideNavbarRoutes.includes(location.pathname));
    }, [location.pathname]);

    return (
        <>
            {showNavbar && <NavBar />}
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
        </>
    );
}

const App = () => (
    <BrowserRouter>
        <MainMenu />
    </BrowserRouter>
);

export default App;
