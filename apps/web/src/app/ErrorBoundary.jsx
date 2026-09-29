import React from 'react';
import { ErrorState } from '../components/ui/Primitives';

/** Catches render errors below it and shows a recoverable error state instead of a white screen. */
export class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { error: null };
  }

  static getDerivedStateFromError(error) {
    return { error };
  }

  componentDidCatch(error, info) {
    console.error('[ErrorBoundary]', error, info?.componentStack);
  }

  render() {
    if (!this.state.error) return this.props.children;
    return (
      <div className="p-6 max-w-2xl mx-auto">
        <ErrorState
          title="Something went wrong on this page"
          message={this.state.error.message || 'Unexpected error.'}
          onRetry={() => this.setState({ error: null })}
        />
      </div>
    );
  }
}
