const mysql = require('mysql2/promise');
const bcrypt = require('bcrypt');
const dotenv = require('dotenv');

dotenv.config();

function parseDatabaseUrl(databaseUrl) {
  const url = new URL(databaseUrl);
  return {
    host: url.hostname,
    port: Number(url.port) || 3306,
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
    host: process.env.DB_HOST || 'localhost',
    port: Number(process.env.DB_PORT || 3306),
    user: process.env.DB_USER || 'root',
    password: process.env.DB_PASSWORD || '',
    database: process.env.DB_NAME || 'kabianga_lost_and_found',
  };

  if (!includeDatabase) delete config.database;
  return config;
}

async function ensureDatabaseExists() {
  const dbName = process.env.DATABASE_URL
    ? parseDatabaseUrl(process.env.DATABASE_URL).database
    : process.env.DB_NAME || 'kabianga_lost_and_found';

  const connection = await mysql.createConnection(getConnectionConfig(false));
  await connection.query(`CREATE DATABASE IF NOT EXISTS \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await connection.end();
}

async function ensureTables(pool) {
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
  const pool = mysql.createPool({
    ...getConnectionConfig(true),
    waitForConnections: true,
    connectionLimit: 10,
    queueLimit: 0,
  });

  await ensureTables(pool);
  await createDefaultUsers(pool);
  await pool.end();

  console.log('Database initialized and default accounts ensured.');
}

module.exports = initDatabase;
