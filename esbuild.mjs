import * as esbuild from 'esbuild';

const serve = process.argv.includes('--serve');
const watch = process.argv.includes('--watch') || serve;

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
} else {
  await Promise.all([
    esbuild.build(rendererOpts),
    esbuild.build(mainOpts),
    esbuild.build(preloadOpts),
  ]);
}
