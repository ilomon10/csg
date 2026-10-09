import './csp-setup';
import './app.css';
import {PreviewViewport} from './preview-viewport';

/** Editor shell root. Feature panels are mounted here as they land (spec 009). */
export function App() {
  return (
    <div className="shell">
      <header className="shell-header">
        <h1>Character Sprite Generator</h1>
      </header>
      <main className="shell-main">
        <PreviewViewport />
      </main>
    </div>
  );
}
