import { describe, expectTypeOf, it } from "vitest";
import type {
  Client as PgClient,
  Pool as PgPool,
  QueryResult,
} from "pg";
import type { Client, Pool } from "../src";

describe("public types", () => {
  it("preserves the node-postgres Client and Pool instance APIs", () => {
    expectTypeOf<Client>().toMatchTypeOf<PgClient>();
    expectTypeOf<Pool>().toMatchTypeOf<PgPool>();
  });

  it("preserves generic query result types", () => {
    type Row = { id: number; title: string };

    if (false) {
      const pool = null as unknown as Pool;
      const client = null as unknown as Client;

      expectTypeOf(pool.query<Row>("select id, title from posts")).toEqualTypeOf<
        Promise<QueryResult<Row>>
      >();
      expectTypeOf(
        client.query<Row>("select id, title from posts"),
      ).toEqualTypeOf<Promise<QueryResult<Row>>>();
    }
  });
});
