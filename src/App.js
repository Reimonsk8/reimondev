import React, { useState, useEffect } from 'react';
/*import particles from './assets/particles.json'*/
import './App.css';
import MainMenu from './components/MainMenu';
import Welcome from './components/Welcome';

const App = () => {
  const [page, setPage] = useState("welcome");

    const component = () => {
      if(page === "welcome"){
        return (
          <div>
            <Welcome />
            <div className="skip" onClick={ ()=> setPage("mainmenu")}>
              <a href=" "> Skip&nbsp;Intro&nbsp;
                <span className="shift">›</span>
              </a>
              <div className="mask"></div>
            </div>
          </div>
        )
      }else if(page === "mainmenu") return <MainMenu/>
    }

    return (
      <div className="App">       
        <div id="particles-js" ></div>
        <header className="App-header">
          {component()}
        </header>
      </div>
    );
};

export default App;
