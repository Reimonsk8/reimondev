process.env.TS_NODE_COMPILER_OPTIONS ||= JSON.stringify({
  module: 'CommonJS',
  moduleResolution: 'node',
  target: 'ES2022',
  esModuleInterop: true,
});
require('ts-node/register/transpile-only');

const { createOutlandsService } = require('./index');
const service = createOutlandsService();
service.listen().then((address) => {
  console.log(`Outlands authoritative dev server listening on ${address.address}:${address.port}`);
}).catch((error) => {
  console.error('Outlands server failed to start:', error.message);
  process.exitCode = 1;
});

const shutdown = () => service.close().finally(() => process.exit(0));
process.once('SIGINT', shutdown);
process.once('SIGTERM', shutdown);
