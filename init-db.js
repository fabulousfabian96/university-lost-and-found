const mysql = require('mysql2/promise');
const { Client: PgClient, Pool: PgPool } = require('pg');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    protocol: url.protocol.replace(':', ''),
    host: url.hostname,
    port: Number(url.port || (url.protocol === 'mysql:' ? 3306 : 5432)),
    user: url.username,
    password: url.password,
    database: url.pathname ? url.pathname.slice(1) : undefined,
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

function isPostgresConfig(config) {
  return config.protocol === 'postgres' || config.protocol === 'postgresql';
}

async function ensureDatabaseExists() {
  const config = getConnectionConfig(false);
  const dbName = process.env.DATABASE_URL
    ? parseDatabaseUrl(process.env.DATABASE_URL).database
    : process.env.DB_NAME || 'kabianga_lost_and_found';

  if (isPostgresConfig(getConnectionConfig(true))) {
    const client = new PgClient({ ...config, database: 'postgres' });
    await client.connect();
    const result = await client.query('SELECT 1 FROM pg_database WHERE datname = $1', [dbName]);
    if (result.rowCount === 0) {
      await client.query(`CREATE DATABASE "${dbName}"`);
    }
    await client.end();
  } else {
    const connection = await mysql.createConnection(config);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();
  }
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

function createPool() {
  const config = getConnectionConfig(true);
  return isPostgresConfig(config)
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
}

async function ensureTables(pool) {
  if (isPostgresConfig(getConnectionConfig(true))) {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id SERIAL PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        image_path VARCHAR(255),
        status VARCHAR(20) NOT NULL DEFAULT 'available',
        reported_by INT NOT NULL,
        claimed_by INT,
        claim_status VARCHAR(20) NOT NULL DEFAULT 'unclaimed',
        claim_message TEXT,
        approved_by INT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      );
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);
  } else {
    await pool.execute(`
      CREATE TABLE IF NOT EXISTS users (
        id INT AUTO_INCREMENT PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role ENUM('admin','security','user') NOT NULL DEFAULT 'user',
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP
      ) ENGINE=InnoDB;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS items (
        id INT AUTO_INCREMENT PRIMARY KEY,
        title VARCHAR(200) NOT NULL,
        description TEXT NOT NULL,
        image_path VARCHAR(255),
        status ENUM('available','claimed') NOT NULL DEFAULT 'available',
        reported_by INT NOT NULL,
        claimed_by INT,
        claim_status ENUM('unclaimed','pending','approved','rejected') NOT NULL DEFAULT 'unclaimed',
        claim_message TEXT,
        approved_by INT,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        updated_at DATETIME DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        FOREIGN KEY (reported_by) REFERENCES users(id) ON DELETE CASCADE,
        FOREIGN KEY (claimed_by) REFERENCES users(id) ON DELETE SET NULL,
        FOREIGN KEY (approved_by) REFERENCES users(id) ON DELETE SET NULL
      ) ENGINE=InnoDB;
    `);

    await pool.execute(`
      CREATE TABLE IF NOT EXISTS notifications (
        id INT AUTO_INCREMENT PRIMARY KEY,
        user_id INT NOT NULL,
        message TEXT NOT NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      ) ENGINE=InnoDB;
    `);
  }
}

async function createDefaultUsers(pool) {
  const defaultUsers = [
    { name: 'Admin Kabianga', email: 'admin@kabianga.ac.ke', password: 'AdminPass123', role: 'admin' },
    { name: 'Security Office', email: 'security@kabianga.ac.ke', password: 'SecurityPass123', role: 'security' },
  ];

  for (const user of defaultUsers) {
    const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [user.email]);
    if (rows.length === 0) {
      const passwordHash = await bcrypt.hash(user.password, 10);
      await pool.execute(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [user.name, user.email, passwordHash, user.role]
      );
    }
  }
}

async function initDatabase() {
  await ensureDatabaseExists();
  const pool = createPool();

  await ensureTables(pool);
  await createDefaultUsers(pool);
  await pool.end();

  console.log('Database initialized and default accounts ensured.');
}

module.exports = initDatabase;
