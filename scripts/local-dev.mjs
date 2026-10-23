import { spawn } from 'child_process';
import path from 'path';
import { fileURLToPath } from 'url';

const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const port = Number(process.env.PORT || 3000);
const dbPort = Number(process.env.LOCAL_DB_PORT || 5432);
const dbName = process.env.LOCAL_DB_NAME || 'thudhuvan';
const dbUser = process.env.LOCAL_DB_USER || 'thudhuvan';
const dbPassword = process.env.LOCAL_DB_PASSWORD || 'thudhuvan';
const postgresPassword = process.env.PG_PASSWORD || 'postgres';
const pgBin = process.env.POSTGRES_BIN || 'C:\\Program Files\\PostgreSQL\\17\\bin';

const workingEnv = {
  ...process.env,
  NODE_ENV: process.env.NODE_ENV || 'development',
  DATABASE_URL: process.env.DATABASE_URL || `postgres://${dbUser}:${dbPassword}@localhost:${dbPort}/${dbName}`,
  JWT_SECRET: process.env.JWT_SECRET || 'dev-jwt-secret-32-characters-long',
  ENCRYPTION_KEY: process.env.ENCRYPTION_KEY || 'a'.repeat(64),
  APP_URL: process.env.APP_URL || `http://localhost:${port}`,
  DEFAULT_COUNTRY: process.env.DEFAULT_COUNTRY || 'IN',
  WORKER_ENABLED: process.env.WORKER_ENABLED || 'true',
  WORKER_RATE: process.env.WORKER_RATE || '10',
  META_APP_SECRET: process.env.META_APP_SECRET || 'dev-meta-secret',
  META_VERIFY_TOKEN: process.env.META_VERIFY_TOKEN || 'dev-meta-token',
  META_GRAPH_VERSION: process.env.META_GRAPH_VERSION || 'v21.0',
  MAIL_MODE: process.env.MAIL_MODE || 'capture',
  PGPASSWORD: postgresPassword,
};

const run = (args, label) => new Promise((resolve, reject) => {
  const child = spawn(path.join(pgBin, 'psql.exe'), args, {
    cwd: rootDir,
    stdio: 'inherit',
    env: { ...workingEnv, PGPASSWORD: postgresPassword },
  });

  child.on('exit', (code) => {
    if (code === 0) resolve(); else reject(new Error(`${label} failed with exit code ${code}`));
  });
  child.on('error', reject);
});

const ensureDatabase = async () => {
  const roleCheck = [
    '-U', 'postgres',
    '-h', 'localhost',
    '-d', 'postgres',
    '-tAc', `SELECT 1 FROM pg_roles WHERE rolname = '${dbUser}'`,
  ];

  const dbCheck = [
    '-U', 'postgres',
    '-h', 'localhost',
    '-d', 'postgres',
    '-tAc', `SELECT 1 FROM pg_database WHERE datname = '${dbName}'`,
  ];

  const roleExists = await new Promise((resolve) => {
    const child = spawn(path.join(pgBin, 'psql.exe'), roleCheck, {
      cwd: rootDir,
      env: { ...workingEnv, PGPASSWORD: postgresPassword },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('exit', (code) => resolve(code === 0 && out.trim() === '1'));
  });

  if (!roleExists) {
    await run(['-U', 'postgres', '-h', 'localhost', '-d', 'postgres', '-c', `CREATE ROLE "${dbUser}" LOGIN PASSWORD '${dbPassword}'`], 'Create local database role');
  }

  const dbExists = await new Promise((resolve) => {
    const child = spawn(path.join(pgBin, 'psql.exe'), dbCheck, {
      cwd: rootDir,
      env: { ...workingEnv, PGPASSWORD: postgresPassword },
      stdio: ['ignore', 'pipe', 'inherit'],
    });

    let out = '';
    child.stdout.on('data', (chunk) => { out += chunk.toString(); });
    child.on('exit', (code) => resolve(code === 0 && out.trim() === '1'));
  });

  if (!dbExists) {
    await run(['-U', 'postgres', '-h', 'localhost', '-d', 'postgres', '-c', `CREATE DATABASE "${dbName}" OWNER "${dbUser}"`], 'Create local database');
  }
};

const main = async () => {
  try {
    await ensureDatabase();
    console.log(`Using local PostgreSQL at localhost:${dbPort}`);

    const migrate = spawn('node', ['src/migrate.js'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: workingEnv,
    });

    await new Promise((resolve, reject) => {
      migrate.on('exit', (code) => (code === 0 ? resolve() : reject(new Error(`Database migration failed with exit code ${code}`))));
      migrate.on('error', reject);
    });

    const child = spawn('node', ['src/server.js'], {
      cwd: rootDir,
      stdio: 'inherit',
      env: workingEnv,
    });

    const shutdown = () => {
      if (!child.killed) child.kill('SIGINT');
    };

    process.on('SIGINT', shutdown);
    process.on('SIGTERM', shutdown);

    child.on('exit', (code) => process.exit(code || 0));
  } catch (error) {
    console.error('Local startup failed:', error);
    process.exit(1);
  }
};

main();
