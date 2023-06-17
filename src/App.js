import React from 'react';
/*import particles from './assets/particles.json'*/
import './App.css';
import MainMenu from './components/MainMenu';

const App = () => {
    return (
      <div className="App">       
        <div id="particles-js" ></div>
        <header className="App-header">
          <MainMenu/>
        </header>
      </div>
    );
};

export default App;
