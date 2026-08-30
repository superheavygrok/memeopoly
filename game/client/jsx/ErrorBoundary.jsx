import React from 'react';

/**
 * Without an error boundary, React unmounts the ENTIRE component tree when any
 * single component throws during render. That is what turned one bad property
 * lookup in the trade modal into "none of the buttons work" -- the whole app
 * had silently unmounted.
 *
 * This keeps a render crash contained: the app stays alive and the user gets a
 * recoverable message instead of a dead screen.
 */
export default class ErrorBoundary extends React.Component {
    state = {error: null};

    static getDerivedStateFromError(error) {
        return {error};
    }

    componentDidCatch(error, info) {
        // Keep the detail in the console for debugging; never render a raw
        // stack trace to the user.
        console.error('[Memeopoly] render error contained by ErrorBoundary:', error, info);
    }

    reset = () => this.setState({error: null});

    render() {
        if (!this.state.error) return this.props.children;

        return (
            <div className="error-boundary">
                <h3>Something broke on this screen</h3>
                <p>The rest of the game is still running. You can close this and keep playing.</p>
                <button className="error-boundary-btn" onClick={this.reset}>Dismiss</button>
            </div>
        );
    }
}
