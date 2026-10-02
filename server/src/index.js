import { openDb } from './db.js';
import { createApp } from './app.js';
import { startScheduler } from './scheduler.js';

const db = openDb();
const app = createApp(db);
startScheduler(db);

const port = Number(process.env.PORT) || 4000;
app.listen(port, () => {
  console.log(`ExposeX API listening on http://localhost:${port}`);
});
