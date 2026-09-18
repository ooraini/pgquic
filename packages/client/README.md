# @ooraini/pgquic

Connect to PostgreSQL from the browser over WebTransport.

```sh
npm install @ooraini/pgquic
```

```ts
import { Pool, PgWebTransport } from "@ooraini/pgquic";

const transport = new PgWebTransport({
  url: "https://db.example.com/v1/session",
  token: () => getAccessToken(),
});

const pool = new Pool({
  transport,
  user: "app_user",
  password: "password",
  database: "app",
  ssl: false,
  enableChannelBinding: false,
});

const result = await pool.query("select now()");
```

The package requires a [pgquic gateway](https://github.com/ooraini/pgquic). See the repository for gateway configuration and deployment.
