import React from 'react';
import particlesJS from 'particles.js'
/*import particles from './assets/particles.json'*/
import './App.css';
import MainMenu from './components/MainMenu';
import Welcome from './components/Welcome.js';



class App extends React.Component{
  state = {
    screen: "welcome"
  }
  nextScreen = (value) => {
    this.setState({screen : "mainmenu"});
    console.log(value);
  }

  componentDidMount() {
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
  }

  render(){

    let component;

    if(this.state.screen === "welcome"){
      component = 
      <div>
        <Welcome />
        <div className="skip" onClick={ ()=> this.nextScreen("value")}>
          <a href=" "> Skip&nbsp;Intro&nbsp;
            <span className="shift">›</span>
          </a>
          <div className="mask"></div>
        </div>
      </div>
    }else if(this.state.screen === "mainmenu"){
      component = <MainMenu/>
    }

    return (   
      <div className="App">
        <div id="particles-js" ></div>
        <header className="App-header">
          {component}
        </header>
      </div>
    );
  };
}

export default App;
