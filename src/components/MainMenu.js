// import { render } from '@testing-library/react';
import React, { useEffect, useState } from 'react';
import { BrowserRouter, Routes , Route, useLocation, useNavigation } from 'react-router-dom';
// eslint-disable-next-line
import particlesJS from 'particles.js'
import NavBar from './Navbar';
import Welcome from './Welcome';
import Home from './pages/Home';
import Resume from './pages/Resume';
import Projects from './pages/Projects';
import PostBoard from './pages/PostBoard';
import SupportMe from './pages/SupportMe'; 
//import Auth from 'aws-amplify';
//import awsconfig from '../aws-exports';
//import {withAuthenticator} from 'aws-amplify-react';
//Auth.configure(awsconfig);

const createParticleBackground = () =>{
    window.particlesJS(
        'particles-js', 
        {
            "particles": {
            "number": {
                "value": 150,
                "density": {
                "enable": true,
                "value_area": 500
                }
            },
            "color": {
                "value": "#ffffff"
            },
            "shape": {
                "type": "circle",
                "stroke": {
                "width": 0,
                "color": "#000000"
                },
                "polygon": {
                "nb_sides": 5
                },
                "image": {
                "src": "img/github.svg",
                "width": 100,
                "height": 100
                }
            },
            "opacity": {
                "value": 0.25,
                "random": true,
                "anim": {
                "enable": false,
                "speed": 0.5,
                "opacity_min": 0.1,
                "sync": false
                }
            },
            "size": {
                "value": 2.5,
                "random": false,
                "anim": {
                "enable": true,
                "speed": 40,
                "size_min": 0.1,
                "sync": false
                }
            },
            "line_linked": {
                "enable": true,
                "distance": 100,
                "color": "#ffffff",
                "opacity": 0.4,
                "width": 2
            },
            "move": {
                "enable": true,
                "speed": 5,
                "direction": "none",
                "random": false,
                "straight": false,
                "out_mode": "out",
                "attract": {
                "enable": true,
                "rotateX": 600,
                "rotateY": 1200
                }
            }
            },
            "interactivity": {
            "detect_on": "canvas",
            "events": {
                "onhover": {
                "enable": true,
                "mode": "repulse"
                },
                "onclick": {
                "enable": true,
                "mode": "push"
                },
                "resize": true
            },
            "modes": {
                "grab": {
                "distance": 400,
                "line_linked": {
                    "opacity": 1
                }
                },
                "bubble": {
                "distance": 400,
                "size": 40,
                "duration": 2,
                "opacity": 8,
                "speed": 3
                },
                "repulse": {
                "distance": 120 // here hover mouse distance radius
                },
                "push": {
                "particles_nb": 4
                },
                "remove": {
                "particles_nb": 2
                }
            }
            },
            "retina_detect": true,
            "config_demo": {
            "hide_card": false,
            "background_color": "#b61924",
            "background_image": "",
            "background_position": "50% 50%",
            "background_repeat": "no-repeat",
            "background_size": "cover"
            }
        }
        );
}

//maybe useful for geting route info
// eslint-disable-next-line
function Dashboard() {
    const location = useLocation()
    const loc = window.location;
    const nav = useNavigation()
    const hist = window.history;
    return console.log(location.pathname, {loc, nav, hist});
  }


const MainMenu = () =>{

    const [showNavbar, setShowNavBar] = useState(false)

    useEffect(() => {
        createParticleBackground();
      }, [])

    return(
        <BrowserRouter>
            {showNavbar ? <NavBar/> :<></>}
            <Routes>
                <Route path='/' element={<Welcome />} />
                <Route path='/home' element={<Home setShowNavBar={setShowNavBar}/>} />
                <Route path='/resume' element={<Resume setShowNavBar={setShowNavBar}/>} />
                <Route path='/projects' element={<Projects setShowNavBar={setShowNavBar}/>} />
                <Route path='/postboard' element={<PostBoard setShowNavBar={setShowNavBar}/>} />
                <Route path='/supportme' element={<SupportMe setShowNavBar={setShowNavBar}/>} />
                <Route path='*' element={<>{/*nopage*/}</>}/>
            </Routes >
        </BrowserRouter>
    )
    
}
// withRouter(MainMenu);

//export default withAuthenticator(MainMenu, {includeGreetings: true});
export default MainMenu;
