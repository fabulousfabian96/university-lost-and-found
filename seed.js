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

function createPostgresPool(config) {
  const pool = new PgPool(config);
  const originalQuery = pool.query.bind(pool);
  const translateQuery = (sql, values = []) => {
    let index = 0;
    const text = sql.replace(/\?/g, () => `$${++index}`);
    return { text, values };
  };

  pool.execute = async (sql, values = []) => {
    const { text, values: params } = translateQuery(sql, values);
    const result = await originalQuery(text, params);
    return [result.rows, result.fields || []];
  };

  return pool;
}

async function run() {
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

    const pool = new PgPool({ ...config, database: dbName });
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id SERIAL PRIMARY KEY,
        name VARCHAR(150) NOT NULL,
        email VARCHAR(200) NOT NULL UNIQUE,
        password_hash VARCHAR(255) NOT NULL,
        role VARCHAR(20) NOT NULL DEFAULT 'user',
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      );
    `);

    await pool.query(`
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

    await pool.query(`
      CREATE TABLE IF NOT EXISTS notifications (
        id SERIAL PRIMARY KEY,
        user_id INT NOT NULL,
        message TEXT NOT NULL,
        is_read BOOLEAN NOT NULL DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
      );
    `);

    async function createDefaultUser(name, email, password, role) {
      const result = await pool.query('SELECT id FROM users WHERE email = $1', [email]);
      if (result.rowCount) return;
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.query(
        'INSERT INTO users (name, email, password_hash, role) VALUES ($1, $2, $3, $4)',
        [name, email, passwordHash, role]
      );
    }

    await createDefaultUser('Admin Kabianga', 'admin@kabianga.ac.ke', 'AdminPass123', 'admin');
    await createDefaultUser('Security Office', 'security@kabianga.ac.ke', 'SecurityPass123', 'security');

    await pool.end();
  } else {
    const connection = await mysql.createConnection(config);
    await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
    await connection.end();

    const pool = mysql.createPool({
      host: config.host,
      port: config.port,
      user: config.user,
      password: config.password,
      database: dbName,
      waitForConnections: true,
      connectionLimit: 10,
      queueLimit: 0,
    });

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

    async function createDefaultUser(name, email, password, role) {
      const [rows] = await pool.execute('SELECT id FROM users WHERE email = ?', [email]);
      if (rows.length) return;
      const passwordHash = await bcrypt.hash(password, 10);
      await pool.execute(
        'INSERT INTO users (name, email, password_hash, role) VALUES (?, ?, ?, ?)',
        [name, email, passwordHash, role]
      );
    }

    await createDefaultUser('Admin Kabianga', 'admin@kabianga.ac.ke', 'AdminPass123', 'admin');
    await createDefaultUser('Security Office', 'security@kabianga.ac.ke', 'SecurityPass123', 'security');

    await pool.end();
  }

  console.log('Database created and seeded. Default accounts:');
  console.log('Admin -> admin@kabianga.ac.ke / AdminPass123');
  console.log('Security -> security@kabianga.ac.ke / SecurityPass123');
}

run().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
