// Slouch root wrapper — infrastructure, not app code.
//
// Mounts your app inside an error boundary, with the Slouch overlay as a sibling
// on top. If the agent's edit throws at runtime, the boundary catches it and shows
// a recovery panel — but the overlay stays alive, so you can prompt a fix from the
// phone instead of crawling back to the Mac.
//
// (A *syntax* error in App.tsx still red-screens the whole Metro bundle; that case
// is only recoverable from the agent window. Runtime errors are handled here.)
import { Component, type ErrorInfo, type ReactNode } from 'react';
import { StyleSheet, Text, View } from 'react-native';
import App from '../App';
import { SlouchOverlay } from './SlouchOverlay';

type BoundaryState = { error: Error | null };

class AppErrorBoundary extends Component<{ children: ReactNode }, BoundaryState> {
  state: BoundaryState = { error: null };

  static getDerivedStateFromError(error: Error): BoundaryState {
    return { error };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.warn('[slouch] app crashed:', error.message, info.componentStack);
  }

  render() {
    if (this.state.error) {
      return (
        <View style={styles.fallback}>
          <Text style={styles.fallbackTitle}>App hit a runtime error</Text>
          <Text style={styles.fallbackBody} selectable>
            {this.state.error.message}
          </Text>
          <Text style={styles.fallbackHint}>
            Use the Slouch pill to ask the agent to fix it — the overlay is
            still alive.
          </Text>
        </View>
      );
    }

    return this.props.children;
  }
}

export function SlouchRoot() {
  return (
    <View style={styles.root}>
      <AppErrorBoundary>
        <App />
      </AppErrorBoundary>
      {__DEV__ ? <SlouchOverlay /> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    flex: 1,
  },
  fallback: {
    flex: 1,
    gap: 12,
    justifyContent: 'center',
    padding: 28,
    backgroundColor: '#1a0b0b',
  },
  fallbackTitle: {
    color: '#fca5a5',
    fontSize: 22,
    fontWeight: '900',
  },
  fallbackBody: {
    color: '#fecaca',
    fontSize: 15,
    lineHeight: 21,
  },
  fallbackHint: {
    color: 'rgba(255,255,255,0.6)',
    fontSize: 14,
    lineHeight: 20,
  },
});
