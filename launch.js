const { spawn } = require('child_process');
const electron = require('electron');

const child = spawn(electron, ['.'], {
  cwd: __dirname,
  stdio: 'ignore',
  detached: true,
  windowsHide: false,
});

child.unref();
