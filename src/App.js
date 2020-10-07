import React from 'react';
import './App.css';
import MainMenu from './components/MainMenu';
import Welcome from './components/Welcome.js'

class App extends React.Component{
  state = {
    screen: "welcome"
  }
  nextScreen = (value) => {
    this.setState({screen : "mainmenu"});
    console.log(value);
  }

  render(){

    let component;

    if(this.state.screen === "welcome"){
      component = <Welcome />
    }else if(this.state.screen === "mainmenu"){
      component = <MainMenu/>
    }

    return (
      <div className="App">
        <header className="App-header">
          <button onClick={ ()=> this.nextScreen("value")}>skip intro</button>
          {component}
        </header>
      </div>
    );
  };
}

export default App;
//export default App;
