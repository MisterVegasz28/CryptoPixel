import React from 'react';

interface State { hasError: boolean; }

class ErrorBoundary extends React.Component<{ children: React.ReactNode }, State> {
  state: State = { hasError: false };

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error: unknown, info: unknown) {
    console.error('Uncaught render error', error, info);
  }

  render() {
    if (this.state.hasError) {
      return (
        <div style={{
          display: 'flex', flexDirection: 'column',
          alignItems: 'center', justifyContent: 'center',
          height: '100vh', fontFamily: 'sans-serif', gap: 12,
          background: '#0a0a0f', color: '#fff',
        }}>
          <h1>Something went wrong</h1>
          <p style={{ color: '#888' }}>Please reload the page.</p>
          <button onClick={() => window.location.reload()} style={{
            padding: '8px 20px', borderRadius: 8, border: 'none',
            background: '#00d4ff', color: '#000', fontWeight: 700, cursor: 'pointer',
          }}>
            Reload
          </button>
        </div>
      );
    }
    return this.props.children;
  }
}
export default ErrorBoundary;