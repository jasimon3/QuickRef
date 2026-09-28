// Bundles the renderer (app.js + editor.js + TipTap) into one file the browser window can load
// directly via <script>, so no bundler config is needed inside index.html itself.
const esbuild = require('esbuild');

esbuild.build({
  entryPoints: ['src/renderer/app.js'],
  bundle: true,
  outfile: 'dist/renderer/bundle.js',
  platform: 'browser',
  format: 'iife',
  sourcemap: true,
  logLevel: 'info'
}).catch(() => process.exit(1));
