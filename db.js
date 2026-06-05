const mysql = require('mysql2/promise');
const { Pool: PgPool } = require('pg');
const dotenv = require('dotenv');

dotenv.config();

function parseDatabaseUrl(databaseUrl) {
  const dbUrl = new URL(databaseUrl);
  return {
    protocol: dbUrl.protocol.replace(':', ''),
    host: dbUrl.hostname,
    port: Number(dbUrl.port || (dbUrl.protocol === 'mysql:' ? 3306 : 5432)),
    user: dbUrl.username,
    password: dbUrl.password,
    database: dbUrl.pathname ? dbUrl.pathname.slice(1) : undefined,
  };
}

function getConnectionConfig(includeDatabase = true) {
  if (process.env.DATABASE_URL) {
    const config = parseDatabaseUrl(process.env.DATABASE_URL);
    if (!includeDatabase) delete config.database;
    return config;
  }

  const config = {
    protocol: process.env.DB_PROTOCOL || 'mysql',
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kabianga_lost_and_found',
  };

  if (!includeDatabase) delete config.database;
  return config;
}

function createPostgresPool(config) {
  const pool = new PgPool(config);
  const originalQuery = pool.query.bind(pool);

  const translateQuery = (sql, values = []) => {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    return { text, values };
  };

  pool.query = async (sql, values) => {
    if (Array.isArray(values)) {
      const { text, values: params } = translateQuery(sql, values);
      return originalQuery(text, params);
    }
    return originalQuery(sql, values);
  };

  pool.execute = async (sql, values = []) => {
    const { text, values: params } = translateQuery(sql, values);
    const result = await originalQuery(text, params);
    return [result.rows, result.fields || []];
  };

  return pool;
}

const config = getConnectionConfig(true);
const engine = config.protocol === 'postgres' || config.protocol === 'postgresql' ? 'postgres' : 'mysql';

const pool = engine === 'postgres'
  ? createPostgresPool(config)
  : mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: config.database,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

module.exports = pool;
