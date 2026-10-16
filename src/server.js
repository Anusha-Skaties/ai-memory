import { createApp } from './app.js';
import { createStore } from './db.js';
import { log } from './log.js';

const port = Number(process.env.PORT) || 8080;

const store = await createStore();
const app = createApp(store);

const server = app.listen(port, () => {
  log.info('Server listening', { port, storage: store.kind });
});

// Cloud Run sends SIGTERM before stopping an instance; finish in-flight requests first.
function shutdown(signal) {
  log.info('Shutting down', { signal });
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 9000).unref();
}
process.on('SIGTERM', shutdown);
process.on('SIGINT', shutdown);
