import React from 'react';
import ReactDOM from 'react-dom/client';
import '@fontsource/instrument-sans/400.css';
import '@fontsource/instrument-sans/500.css';
import '@fontsource/instrument-sans/600.css';
import '@fontsource/jetbrains-mono/400.css';
import '@fontsource/jetbrains-mono/500.css';
import '@fontsource/source-serif-4/400.css';
import '@fontsource/source-serif-4/500.css';
import './styles/tokens.css';
import './styles/global.css';
import { applyCachedZoom } from './lib/zoom';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);
const render = (node: React.ReactNode) => root.render(<React.StrictMode>{node}</React.StrictMode>);

// About Gitgel, Software Update and What's New are windows of their own (`windows.rs`): the
// same page with `?window=<label>`, without Monaco or the app's stores.
const aux = new URLSearchParams(window.location.search).get('window');

if (aux) {
  void import('./windows/AuxApp').then(({ AuxApp }) => render(<AuxApp label={aux} />));
} else if (import.meta.env.DEV && window.location.hash.startsWith('#list')) {
  // Dev only: /#list (or /#list-light) shows the List variants (components/List.story.tsx).
  void import('./components/List.story').then(({ ListStory }) => render(<ListStory />));
} else {
  // Monaco first (monaco/setup.ts), then the app.
  applyCachedZoom();
  void import('./monaco/setup').then(() => import('./App')).then(({ default: App }) => render(<App />));
}
