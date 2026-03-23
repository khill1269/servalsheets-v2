import { spawn } from 'child_process';

const server = spawn('node', ['dist/index.js'], {
  env: {
    ...process.env,
    GOOGLE_CLIENT_ID: 'test-client',
    GOOGLE_CLIENT_SECRET: 'test-secret',
  },
  stdio: ['pipe', 'pipe', 'pipe'],
});

let msgId = 0;
const send = (obj) => server.stdin.write(JSON.stringify(obj) + '\n');

let buffer = '';
server.stdout.on('data', (data) => {
  buffer += data.toString();
  const lines = buffer.split('\n');
  buffer = lines.pop();

  for (const line of lines) {
    if (!line.trim()) continue;
    try {
      const msg = JSON.parse(line);
      if (msg.id === 1) {
        const tools = msg.result?.tools || [];
        console.log(`Found ${tools.length} tools\n`);

        // Check first tool
        if (tools.length > 0) {
          const t = tools[0];
          console.log(`Tool: ${t.name}`);
          console.log(`InputSchema type: ${t.inputSchema?.type || 'none'}`);
          console.log(`Has oneOf: ${!!t.inputSchema?.oneOf}`);
          console.log(`Has properties: ${!!t.inputSchema?.properties}`);

          if (t.inputSchema?.oneOf) {
            console.log(`OneOf count: ${t.inputSchema.oneOf.length}`);
            console.log(
              'First variant:',
              JSON.stringify(t.inputSchema.oneOf[0], null, 2).slice(0, 300)
            );
          } else if (t.inputSchema?.properties) {
            console.log(`Properties count: ${Object.keys(t.inputSchema.properties).length}`);
          }
        }

        setTimeout(() => process.exit(0), 100);
      }
    } catch (e) {
      // Not JSON
    }
  }
});

server.stderr.on('data', (data) => {
  console.error('STDERR:', data.toString().slice(0, 500));
});

server.on('error', (err) => {
  console.error('Server error:', err);
});

setTimeout(() => {
  send({
    method: 'initialize',
    params: {
      protocolVersion: '2025-11-25',
      capabilities: {},
      clientInfo: { name: 'test', version: '1.0' },
    },
    jsonrpc: '2.0',
    id: msgId++,
  });
}, 500);

setTimeout(() => {
  send({ method: 'notifications/initialized', jsonrpc: '2.0' });
}, 1000);

setTimeout(() => {
  send({ method: 'tools/list', jsonrpc: '2.0', id: msgId++ });
}, 1500);

setTimeout(() => {
  console.log('Timeout - no response');
  process.exit(1);
}, 8000);
