import React from 'react';
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
