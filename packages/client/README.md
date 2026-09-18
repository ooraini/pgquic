# @ooraini/pgquic

Connect to PostgreSQL from the browser over WebTransport.

## npm

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

## HTML

The package is a self-contained ES module and can be imported without a build step:

```html
<script type="module">
  import {
    Pool,
    PgWebTransport,
  } from "https://cdn.jsdelivr.net/npm/@ooraini/pgquic@0.1.0/dist/index.js";

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
</script>
```

Use `<script type="module">`; the package does not expose a global for classic scripts.

Both approaches require a [pgquic gateway](https://github.com/ooraini/pgquic):

```sh
docker pull ghcr.io/ooraini/pgquic-gateway:0.1.0
```

See the repository for gateway configuration and deployment.
