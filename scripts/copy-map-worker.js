// Copies maplibre-gl's web worker next to the web app. maplibre-gl 6 loads its worker from a URL
// relative to its own module, which a bundler cannot preserve, so the app serves this copy and
// points maplibre at it with setWorkerUrl. Runs after every install to stay version-matched.
const fs = require('fs');
const path = require('path');
const src = path.join(__dirname, '..', 'node_modules', 'maplibre-gl', 'dist', 'maplibre-gl-worker.mjs');
const dest = path.join(__dirname, '..', 'public', 'maplibre-gl-worker.js');
if (fs.existsSync(src)) {
  fs.mkdirSync(path.dirname(dest), { recursive: true });
  fs.copyFileSync(src, dest);
}
