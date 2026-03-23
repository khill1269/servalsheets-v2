import { createHttpServer } from '../dist/http-server.js';

const REQUIRED_HEALTH_ROUTES = ['/health', '/health/live', '/health/ready'];

function getRouteStack(app) {
  if (app && typeof app === 'function') {
    if (app.router?.stack) {
      return app.router.stack;
    }
    if (app._router?.stack) {
      return app._router.stack;
    }
  }
  return [];
}

async function main() {
  process.env.ENABLE_METRICS_SERVER = 'false';

  const server = createHttpServer({ host: '127.0.0.1', port: 0 });
  const stack = getRouteStack(server.app);

  for (const route of REQUIRED_HEALTH_ROUTES) {
    const hasGetRoute = stack.some(
      (layer) => layer.route?.path === route && layer.route.methods?.get === true
    );

    if (!hasGetRoute) {
      throw new Error(`Missing required GET health route: ${route}`);
    }
  }

  const hasHeadHealth = stack.some(
    (layer) => layer.route?.path === '/health' && layer.route.methods?.head === true
  );

  if (!hasHeadHealth) {
    throw new Error('Missing required HEAD health route: /health');
  }

  await server.start();
}

main()
  .then(() => {
    process.exit(0);
  })
  .catch((error) => {
    console.error(error instanceof Error ? error.message : String(error));
    process.exit(1);
  });
