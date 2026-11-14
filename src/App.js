import React from 'react';
import './styles/App.css';
import MainMenu from './components/MainMenu';
import AuroraBackdrop from './components/AuroraBackdrop';
import { AuroraLabPanel, AuroraSettingsProvider } from './components/AuroraLab';

const App = () => (
  <AuroraSettingsProvider>
    <div className="App">
      <header className="App-header">
      </header>
      <AuroraBackdrop />
      <MainMenu />
      {/* Hidden experimental panel — type "eclipse" anywhere to open it. */}
      <AuroraLabPanel />
    </div>
  </AuroraSettingsProvider>
);

export default App;
