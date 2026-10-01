import 'dotenv/config';
import { Pool } from 'pg';
export const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'true' ? { rejectUnauthorized: true } : undefined,
  max: Number(process.env.PG_POOL_MAX || 10),
  idleTimeoutMillis: 30_000,
  connectionTimeoutMillis: 5_000,
});

pool.on('error', (error) => console.error('Unexpected PostgreSQL pool error', error));

export async function initializeDatabase() {
  await pool.query(`CREATE TABLE IF NOT EXISTS accounts (
    id TEXT PRIMARY KEY, email TEXT NOT NULL UNIQUE, name VARCHAR(32) NOT NULL,
    password_hash TEXT NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS account_sessions (
    token_hash CHAR(64) PRIMARY KEY, account_id TEXT NOT NULL REFERENCES accounts(id) ON DELETE CASCADE,
    expires_at TIMESTAMPTZ NOT NULL, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`CREATE TABLE IF NOT EXISTS rooms (
    id TEXT PRIMARY KEY,
    code VARCHAR(8) UNIQUE NOT NULL,
    owner_id TEXT NOT NULL,
    video_id VARCHAR(11),
    playback_time DOUBLE PRECISION NOT NULL DEFAULT 0,
    is_playing BOOLEAN NOT NULL DEFAULT FALSE,
    state_updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query(`DO $$ BEGIN
    IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'current_time')
       AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'rooms' AND column_name = 'playback_time') THEN
      ALTER TABLE rooms RENAME COLUMN "current_time" TO playback_time;
    END IF;
  END $$`);
  await pool.query(`CREATE TABLE IF NOT EXISTS participants (
    id TEXT PRIMARY KEY,
    room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    name VARCHAR(32) NOT NULL,
    role VARCHAR(16) NOT NULL CHECK (role IN ('host', 'moderator', 'participant')),
    token_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS participants_room_idx ON participants(room_id)');
  await pool.query('ALTER TABLE participants ADD COLUMN IF NOT EXISTS account_id TEXT REFERENCES accounts(id) ON DELETE SET NULL');
  await pool.query('CREATE INDEX IF NOT EXISTS participants_account_idx ON participants(account_id)');
  await pool.query(`CREATE TABLE IF NOT EXISTS room_requests (
    id TEXT PRIMARY KEY, room_id TEXT NOT NULL REFERENCES rooms(id) ON DELETE CASCADE,
    user_id TEXT NOT NULL REFERENCES participants(id) ON DELETE CASCADE, username VARCHAR(32) NOT NULL,
    action VARCHAR(16) NOT NULL, payload JSONB, created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
  )`);
  await pool.query('CREATE INDEX IF NOT EXISTS rooms_created_idx ON rooms(created_at DESC)');
}
