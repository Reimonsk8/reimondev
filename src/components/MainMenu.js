import { render } from '@testing-library/react';
import React, { useEffect } from 'react';
import particlesJS from 'particles.js'
//import Auth from 'aws-amplify';
//import awsconfig from '../aws-exports';
//import {withAuthenticator} from 'aws-amplify-react';
//Auth.configure(awsconfig);
const MainMenu = ()=>{
    
    useEffect(()=>{
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
                "distance": 200
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
    },[]);

    return(
        <div>
            <p>WELCOME</p>
            <p>Main Menu</p>
            <p className="App-link">
                COMING SOON
            </p>


            <p>
                Reimon <code> Testing </code> new stuff.
            </p>
            <p className="App-link">
                Chopin is beautiful
            </p>
        </div>
    )
    
}
//export default withAuthenticator(MainMenu, {includeGreetings: true});
export default MainMenu;
