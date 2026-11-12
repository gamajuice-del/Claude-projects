// Bundles the game into one self-contained HTML file (dist/index.html) and, with --test, the headless test bundles.
import { build } from 'esbuild';
import { readFileSync, writeFileSync, existsSync, mkdirSync } from 'node:fs';

const test = process.argv.includes('--test');
mkdirSync('dist', { recursive: true });

if (test) {
  const entries = ['test/scenarios.ts', 'test/soak.ts'].filter((f) => existsSync(f));
  for (const e of entries) {
    await build({ entryPoints: [e], bundle: true, platform: 'node', format: 'esm', target: 'node20', outfile: 'dist/' + e.split('/').pop().replace('scenarios', 'test').replace('.ts', '.mjs'), logLevel: 'warning' });
  }
} else {
  const res = await build({ entryPoints: ['src/main.ts'], bundle: true, format: 'iife', target: 'es2020', minify: true, write: false, logLevel: 'warning' });
  const js = res.outputFiles[0].text.replace(/<\/script/g, '<\\/script');
  const css = readFileSync('src/ui/style.css', 'utf8');
  const body = readFileSync('src/ui/body.html', 'utf8');
  const head = `<title>Project Genesis</title>\n<meta name="claude:viewport-fit-sides" content="cover">\n<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Pixelify+Sans:wght@400;600&family=IBM+Plex+Sans:wght@400;500;600&display=swap">\n<style>\n${css}\n</style>`;
  const fragment = `${head}\n${body}\n<script>\n${js}\n</script>\n`;
  // artifact.html: page fragment for hosted publishing. index.html: the same game as a standalone file.
  writeFileSync('dist/artifact.html', fragment);
  writeFileSync('dist/index.html', `<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">\n${head}\n</head>\n<body>\n${body}\n<script>\n${js}\n</script>\n</body>\n</html>\n`);
  console.log(`built dist/index.html (${(js.length / 1024).toFixed(0)} KB js)`);
}
