import './monaco/setup';
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
import App from './App';

const root = ReactDOM.createRoot(document.getElementById('root') as HTMLElement);

// Dev only: /#list (or /#list-light) shows the List variants (components/List.story.tsx)
// instead of the app.
if (import.meta.env.DEV && window.location.hash.startsWith('#list')) {
  void import('./components/List.story').then(({ ListStory }) =>
    root.render(
      <React.StrictMode>
        <ListStory />
      </React.StrictMode>,
    ),
  );
} else {
  root.render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  );
}
