// Проверка: как клиент node-postgres соединяется с PostgreSQL 18 на этом сервере
const path = require("path");
const fs = require("fs");

const envFile = "/srv/narazborku/app/apps/backend/.env";
const env = Object.fromEntries(
  fs.readFileSync(envFile, "utf8").split("\n").filter(Boolean).map((l) => {
    const i = l.indexOf("=");
    return [l.slice(0, i), l.slice(i + 1)];
  })
);
const url = env.DATABASE_URL;
const pass = url.match(/:\/\/[^:]+:([^@]+)@/)[1];

const candidates = [
  { name: "127.0.0.1 (IPv4)", conn: `postgres://medusa:${pass}@127.0.0.1:5432/narazborku_store` },
  { name: "::1 (IPv6)", conn: `postgres://medusa:${pass}@[::1]:5432/narazborku_store` },
  { name: "localhost", conn: `postgres://medusa:${pass}@localhost:5432/narazborku_store` },
];

(async () => {
  const { Client } = require(path.join(
    "/srv/narazborku/app/apps/backend/.medusa/server/node_modules/pg"
  ));

  for (const c of candidates) {
    const t0 = Date.now();
    try {
      const client = new Client({ connectionString: c.conn, connectionTimeoutMillis: 8000 });
      await client.connect();
      const r = await client.query("select current_user, inet_server_addr()::text as addr, version()");
      await client.end();
      console.log(`✔ ${c.name}: подключился за ${Date.now() - t0} мс | адрес сервера: ${r.rows[0].addr}`);
    } catch (e) {
      console.log(`✖ ${c.name}: ${String(e.message).slice(0, 120)} (${Date.now() - t0} мс)`);
    }
  }

  // 10 параллельных соединений
  const t1 = Date.now();
  let ok = 0, err = 0;
  await Promise.all(
    Array.from({ length: 10 }).map(async () => {
      const client = new Client({ connectionString: candidates[0].conn, connectionTimeoutMillis: 10000 });
      try {
        await client.connect();
        await client.query("select 1");
        await client.end();
        ok++;
      } catch (e) {
        err++;
      }
    })
  );
  console.log(`10 параллельных соединений: успешно ${ok}, ошибок ${err}, за ${Date.now() - t1} мс`);
  process.exit(0);
})();
