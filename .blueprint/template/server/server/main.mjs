// @@APP_NAME@@: the app server. The blueprint's core (server/core/) does configuration,
// database, migrations and HTTP; this file only lists the API of this app (server/api/).
import { start } from './core/server.mjs';
import items from './api/items.mjs';

await start({ routes: [items] });
