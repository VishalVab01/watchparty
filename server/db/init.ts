import { initializeDatabase, pool } from './pool.js';

try {
  await initializeDatabase();
  console.log('Watchparty database is ready.');
} catch (error) {
  console.error('Could not initialize PostgreSQL:', error);
  process.exitCode = 1;
} finally {
  await pool.end();
}
