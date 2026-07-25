import * as esbuild from 'esbuild';
import { cp, mkdir, rm, writeFile } from 'node:fs/promises';

const serve = process.argv.includes('--serve');
const watch = process.argv.includes('--watch') || serve;
// --site assembles the static browser build published to GitHub Pages. It needs
// no Electron output: bridge.ts feature-detects window.paintBridge and falls
// back to browser file pickers, downloads, and the async Clipboard API.
const site = process.argv.includes('--site');
const SITE_DIR = 'site';

const rendererOpts = {
  entryPoints: ['src/app.ts'],
  bundle: true,
  outfile: 'dist/renderer.js',
  format: 'iife',
  target: 'es2020',
  sourcemap: serve ? 'inline' : false,
  logLevel: 'info',
};

const selftestOpts = {
  entryPoints: ['tests/selftest.ts'],
  bundle: true,
  outfile: 'dist/selftest.js',
  format: 'iife',
  target: 'es2020',
  sourcemap: 'inline',
  logLevel: 'info',
};

const mainOpts = {
  entryPoints: ['electron/main.ts'],
  bundle: true,
  outfile: 'dist/main.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
};

const preloadOpts = {
  entryPoints: ['electron/preload.ts'],
  bundle: true,
  outfile: 'dist/preload.cjs',
  format: 'cjs',
  platform: 'node',
  target: 'node20',
  external: ['electron'],
  logLevel: 'info',
};

if (serve) {
  const ctx = await esbuild.context(rendererOpts);
  await ctx.watch();
  const testCtx = await esbuild.context(selftestOpts);
  await testCtx.watch();
  const { hosts, port } = await ctx.serve({ servedir: '.', port: 5173 });
  console.log(`\n  Paint (browser build) running at http://localhost:${port}/\n`);
} else if (site) {
  await rm(SITE_DIR, { recursive: true, force: true });
  await mkdir(`${SITE_DIR}/dist`, { recursive: true });
  await esbuild.build({ ...rendererOpts, outfile: `${SITE_DIR}/dist/renderer.js` });
  // index.html loads styles.css and dist/renderer.js by relative path, so the
  // same tree works at a domain root or under a /<repo>/ project path.
  await cp('index.html', `${SITE_DIR}/index.html`);
  await cp('styles.css', `${SITE_DIR}/styles.css`);
  // Keeps Pages from treating dist/ and friends as Jekyll input.
  await writeFile(`${SITE_DIR}/.nojekyll`, '');
  console.log(`\n  Static site written to ${SITE_DIR}/\n`);
} else {
  await Promise.all([
    esbuild.build(rendererOpts),
    esbuild.build(mainOpts),
    esbuild.build(preloadOpts),
  ]);
}
