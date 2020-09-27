import React from 'react';
import logo from './logo.png';
import './App.css';

function App() {
  return (
    <div className="App">
      <header className="App-header">
        <img src={logo} className="App-logo" alt="logo" />
        <p>
          Reimon <code> Testing </code> new stuff.
        </p>
        <p>
          UPDATED 1:06 AM
        </p>
        <a
          className="App-link"
          target="_blank"
          rel="noopener noreferrer"
        >
          Chopin is beautiful
        </a>
      </header>
    </div>
  );
}

export default App;
