import { Component } from 'react';

export default class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('Game crashed:', error, info);
  }

  render() {
    if (this.state.error) {
      return (
        <div style={{
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          padding: '40px 20px',
          textAlign: 'center',
          color: '#e2e8f0',
        }}>
          <h2 style={{ color: '#fbbf24', marginBottom: '8px', fontSize: '20px' }}>Something went wrong</h2>
          <p style={{ color: '#94a3b8', marginBottom: '16px', fontSize: '14px', maxWidth: '420px' }}>
            This game hit an unexpected error. The rest of the casino is fine — reload to try again.
          </p>
          <pre style={{
            background: '#1e293b',
            border: '1px solid rgba(255,255,255,0.1)',
            padding: '10px 14px',
            borderRadius: '8px',
            fontSize: '12px',
            overflow: 'auto',
            maxWidth: '520px',
            maxHeight: '160px',
            textAlign: 'left',
            color: '#f87171',
          }}>{String(this.state.error?.message || this.state.error)}</pre>
          <button
            onClick={() => window.location.reload()}
            className="primary-button btn-emerald"
            style={{
              marginTop: '20px',
              padding: '12px 28px',
            }}
          >
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
