const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const rootDir = path.resolve(__dirname, '..', '..');
const bundleDir = path.join(rootDir, 'examples', 'bundle');

function copyAssetsIntoBundle() {
  const sourceDir = path.join(rootDir, 'assets');
  const targetDir = path.join(bundleDir, 'assets');

  fs.rmSync(targetDir, { recursive: true, force: true });
  fs.mkdirSync(bundleDir, { recursive: true });
  fs.cpSync(sourceDir, targetDir, { recursive: true });
}

function main() {
  copyAssetsIntoBundle();

  // This build step is used by the GitHub Actions deploy workflow.
  // The homepage is generated after assets are copied so all relative links
  // resolve against the final published directory structure.
  execFileSync(
    process.execPath,
    [path.join(__dirname, 'renderReadme.js'), 'README.md', 'examples/bundle/index.html'],
    {
      cwd: rootDir,
      stdio: 'inherit'
    }
  );
}

main();
