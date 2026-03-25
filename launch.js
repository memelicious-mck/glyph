const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: __dirname,
  stdio: 'inherit',
  windowsHide: false,
});

child.on('close', (code) => process.exit(code));
