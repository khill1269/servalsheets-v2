import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

console.log('Server spawned, PID:', server.pid);

server.stdout.on('data', (data) => {
  console.log('STDOUT:', data.toString().slice(0, 1000));
});

server.stderr.on('data', (data) => {
  console.log('STDERR:', data.toString().slice(0, 1000));
});

server.on('error', (err) => {
  console.error('Spawn error:', err);
});

server.on('exit', (code) => {
  console.log('Server exited with code:', code);
});

// Give it time to start
setTimeout(() => {
  console.log('Sending initialize...');
  const msg = JSON.stringify({
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    },
    jsonrpc: '2.0',
    id: 0,
  });
  console.log('Message:', msg);
  server.stdin.write(msg + '\n');
}, 2000);

setTimeout(() => {
  console.log('Test complete, killing server');
  server.kill();
  process.exit(0);
}, 6000);
