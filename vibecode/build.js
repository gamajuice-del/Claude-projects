#!/usr/bin/env node
// Bundles index.html + styles.css + js/*.js into single-file builds:
//   dist/vibecode.html  — a standalone page (open it straight from disk)
//   dist/artifact.html  — the same page without the document skeleton, for hosts that add their own
const fs = require('fs');
const path = require('path');
const root = __dirname;
const html = fs.readFileSync(path.join(root, 'index.html'), 'utf8');
const css = fs.readFileSync(path.join(root, 'styles.css'), 'utf8');
const scripts = [...html.matchAll(/<script src="([^"]+)"><\/script>/g)].map((m) => m[1]);
const js = scripts.map((src) => {
  const code = fs.readFileSync(path.join(root, src), 'utf8');
  if (/<\/script/i.test(code)) throw new Error(src + ' contains </script');
  return '/* ' + src + ' */\n' + code;
}).join('\n');
const body = html.split('<!--BODY-->')[1].split('<!--/BODY-->')[0].trim();
const fonts = (html.match(/<link rel="preconnect"[^>]*>\s*/g) || []).join('') + (html.match(/<link rel="stylesheet" href="https:\/\/fonts[^>]*>/) || [''])[0];
const head = '<title>VibeCode</title>\n<meta name="description" content="Don\'t play the game. Prompt it into existence.">\n' + fonts + '\n<style>\n' + css + '\n</style>';
const scriptTag = '<script>\n' + js + '\n</script>';
const standalone = '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">\n' + head + '\n</head>\n<body>\n' + body + '\n' + scriptTag + '\n</body>\n</html>\n';
const artifact = head + '\n' + body + '\n' + scriptTag + '\n';
fs.mkdirSync(path.join(root, 'dist'), { recursive: true });
fs.writeFileSync(path.join(root, 'dist', 'vibecode.html'), standalone);
fs.writeFileSync(path.join(root, 'dist', 'artifact.html'), artifact);
console.log('dist/vibecode.html', (standalone.length / 1024).toFixed(1) + ' kB', '·', scripts.length, 'scripts');
