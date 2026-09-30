import 'dotenv/config';
import express from 'express';
import cors from 'cors';
import { createServer } from 'node:http';
import { resolve } from 'node:path';
import { Server, Socket } from 'socket.io';
import type { PoolClient } from 'pg';
import { z } from 'zod';
import { nanoid } from 'nanoid';
import { pool, initializeDatabase } from './db/pool.js';
import { hashToken, makeId, makeToken, normalizeCode } from './identity.js';

type Role = 'host' | 'moderator' | 'participant';
type Action = 'play' | 'pause' | 'seek' | 'change_video';
type Member = { id: string; name: string; role: Role };
type RoomSnapshot = { code: string; videoId: string | null; currentTime: number; isPlaying: boolean; updatedAt: number; participants: Member[] };
type AuthData = { roomId: string; code: string; member: Member };
type RoomSocket = Socket & { data: Socket['data'] & { auth: AuthData } };
type ClientRequest = { action: Action; payload?: { time?: number; videoId?: string } };
type PendingRequest = ClientRequest & { id: string; roomId: string; userId: string; username: string; createdAt: number };

const app = express();
const server = createServer(app);
const clientOrigin = process.env.CLIENT_ORIGIN || 'http://localhost:5173';
app.use(cors({ origin: clientOrigin, credentials: true }));
app.use(express.json({ limit: '16kb' }));
const io = new Server(server, { cors: { origin: clientOrigin, methods: ['GET', 'POST'] }, maxHttpBufferSize: 1e5, pingTimeout: 20_000, pingInterval: 25_000 });

const createSchema = z.object({ username: z.string().trim().min(1).max(32) });
const joinSchema = createSchema.extend({ code: z.string().trim().min(4).max(12) });
const codeSchema = z.string().trim().min(4).max(12);
const requestSchema = z.object({ action: z.enum(['play', 'pause', 'seek', 'change_video']), payload: z.object({ time: z.number().finite().min(0).max(86_400).optional(), videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/).optional() }).optional() });
const socketAuth = z.object({ code: z.string(), token: z.string().min(40).max(100) });
const asyncRoute = (handler: express.RequestHandler): express.RequestHandler => (req, res, next) => {
  Promise.resolve(handler(req, res, next)).catch(next);
};

const socketIdsByMember = new Map<string, Set<string>>();
const runtime = new Map<string, { videoId: string | null; currentTime: number; isPlaying: boolean; updatedAt: number }>();
const pendingRequests = new Map<string, PendingRequest>();
const requestTimesByMember = new Map<string, number[]>();
const memberSockets = (roomId: string, memberId: string) => `${roomId}:${memberId}`;

async function listOnlineParticipants(roomId: string): Promise<Member[]> {
  const { rows } = await pool.query<Member>(
    `SELECT p.id, p.name, p.role FROM participants p
     WHERE p.room_id = $1 AND EXISTS (
       SELECT 1 FROM unnest($2::text[]) AS online(id) WHERE online.id = p.id
     ) ORDER BY CASE p.role WHEN 'host' THEN 0 WHEN 'moderator' THEN 1 ELSE 2 END, p.created_at`,
    [roomId, [...socketIdsByMember.keys()].filter((key) => key.startsWith(`${roomId}:`)).map((key) => key.slice(roomId.length + 1))],
  );
  return rows;
}

async function snapshot(roomId: string, code: string): Promise<RoomSnapshot> {
  const state = runtime.get(roomId);
  if (!state) {
    const { rows } = await pool.query('SELECT video_id, playback_time, is_playing, state_updated_at FROM rooms WHERE id = $1', [roomId]);
    const row = rows[0];
    if (!row) throw new Error('Room not found');
    runtime.set(roomId, { videoId: row.video_id, currentTime: Number(row.playback_time), isPlaying: row.is_playing, updatedAt: new Date(row.state_updated_at).getTime() });
  }
  const current = runtime.get(roomId)!;
  return { code, ...current, participants: await listOnlineParticipants(roomId) };
}

async function issueSession(roomId: string, code: string, member: Member, token: string) {
  return { roomId, code, userId: member.id, username: member.name, role: member.role, token };
}

app.get('/api/health', asyncRoute(async (_req, res) => {
  try { await pool.query('SELECT 1'); res.json({ ok: true }); }
  catch { res.status(503).json({ ok: false, error: 'Database unavailable' }); }
}));

app.post('/api/rooms', asyncRoute(async (req, res) => {
  const parsed = createSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Add a name, up to 32 characters.' });
  const roomId = makeId();
  const userId = makeId();
  const token = makeToken();
  const code = nanoid(6).toUpperCase();
  let client: PoolClient | null = null;
  try {
    client = await pool.connect();
    await client.query('BEGIN');
    await client.query('INSERT INTO rooms (id, code, owner_id) VALUES ($1, $2, $3)', [roomId, code, userId]);
    await client.query('INSERT INTO participants (id, room_id, name, role, token_hash) VALUES ($1, $2, $3, $4, $5)', [userId, roomId, parsed.data.username, 'host', hashToken(token)]);
    await client.query('COMMIT');
    runtime.set(roomId, { videoId: null, currentTime: 0, isPlaying: false, updatedAt: Date.now() });
    res.status(201).json(await issueSession(roomId, code, { id: userId, name: parsed.data.username, role: 'host' }, token));
  } catch (error) {
    if (client) await client.query('ROLLBACK').catch(() => undefined);
    console.error('Room creation failed', error);
    res.status(500).json({ error: 'Could not create the room. Try again.' });
  } finally { client?.release(); }
}));

app.post('/api/rooms/join', asyncRoute(async (req, res) => {
  const parsed = joinSchema.safeParse(req.body);
  if (!parsed.success) return res.status(400).json({ error: 'Enter a room code and your name.' });
  const code = normalizeCode(parsed.data.code);
  try {
    const { rows } = await pool.query('SELECT id FROM rooms WHERE code = $1', [code]);
    if (!rows[0]) return res.status(404).json({ error: 'We could not find that room. Check the code and try again.' });
    const roomId = rows[0].id as string;
    const userId = makeId();
    const token = makeToken();
    await pool.query('INSERT INTO participants (id, room_id, name, role, token_hash) VALUES ($1, $2, $3, $4, $5)', [userId, roomId, parsed.data.username, 'participant', hashToken(token)]);
    res.status(201).json(await issueSession(roomId, code, { id: userId, name: parsed.data.username, role: 'participant' }, token));
  } catch (error) {
    console.error('Room join failed', error);
    res.status(500).json({ error: 'Could not join right now. Try again.' });
  }
}));

app.get('/api/rooms/:code', asyncRoute(async (req, res) => {
  const valid = codeSchema.safeParse(req.params.code);
  if (!valid.success) return res.status(400).json({ error: 'That room code is not valid.' });
  const code = normalizeCode(valid.data);
  const { rows } = await pool.query('SELECT id FROM rooms WHERE code = $1', [code]);
  if (!rows[0]) return res.status(404).json({ error: 'Room not found.' });
  res.json({ code });
}));

app.use(express.static(resolve(process.cwd(), 'dist'), { maxAge: process.env.NODE_ENV === 'production' ? '1h' : 0 }));
app.get('/room/:code', (_req, res) => res.sendFile(resolve(process.cwd(), 'dist', 'index.html')));
app.use((error: unknown, _req: express.Request, res: express.Response, _next: express.NextFunction) => {
  console.error('Unhandled HTTP error', error);
  if (!res.headersSent) res.status(500).json({ error: 'Something went wrong. Please try again.' });
});

io.use(async (socket, next) => {
  const parsed = socketAuth.safeParse(socket.handshake.auth);
  if (!parsed.success) return next(new Error('Enter the room again to reconnect.'));
  try {
    const { rows } = await pool.query(
      `SELECT r.id AS room_id, r.code, p.id, p.name, p.role FROM rooms r
       JOIN participants p ON p.room_id = r.id
       WHERE r.code = $1 AND p.token_hash = $2`,
      [normalizeCode(parsed.data.code), hashToken(parsed.data.token)],
    );
    if (!rows[0]) return next(new Error('This room session is no longer active.'));
    const row = rows[0];
    socket.data.auth = { roomId: row.room_id, code: row.code, member: { id: row.id, name: row.name, role: row.role } } satisfies AuthData;
    next();
  } catch { next(new Error('Could not connect to the room.')); }
});

function currentRoom(socket: RoomSocket) {
  return socket.data.auth as AuthData;
}
function canControl(member: Member) { return member.role === 'host' || member.role === 'moderator'; }
function emitError(socket: RoomSocket, message: string) { socket.emit('action_error', { message }); }

async function persistState(roomId: string, state: { videoId: string | null; currentTime: number; isPlaying: boolean; updatedAt: number }) {
  await pool.query('UPDATE rooms SET video_id = $2, playback_time = $3, is_playing = $4, state_updated_at = NOW() WHERE id = $1', [roomId, state.videoId, state.currentTime, state.isPlaying]);
  runtime.set(roomId, state);
}

async function applyAction(roomId: string, code: string, member: Member, action: Action, payload: { time?: number; videoId?: string } = {}) {
  if (!canControl(member)) throw new Error('Only a Host or Moderator can change playback.');
  const before = runtime.get(roomId) || { videoId: null, currentTime: 0, isPlaying: false, updatedAt: Date.now() };
  let next = { ...before, updatedAt: Date.now() };
  if (action === 'play') next.isPlaying = true;
  if (action === 'pause') next.isPlaying = false;
  if (action === 'seek' && typeof payload.time === 'number') next.currentTime = payload.time;
  if (action === 'change_video' && payload.videoId) next = { ...next, videoId: payload.videoId, currentTime: 0, isPlaying: false };
  if (action === 'seek' && typeof payload.time !== 'number') throw new Error('Choose a valid point in the video.');
  if (action === 'change_video' && !payload.videoId) throw new Error('Add a valid YouTube video link.');
  await persistState(roomId, next);
  io.to(roomId).emit('sync_state', await snapshot(roomId, code));
}

io.on('connection', async (rawSocket) => {
  const socket = rawSocket as RoomSocket;
  const { roomId, code, member } = currentRoom(socket);
  const key = memberSockets(roomId, member.id);
  const sockets = socketIdsByMember.get(key) || new Set<string>();
  const wasOnline = sockets.size > 0;
  sockets.add(socket.id);
  socketIdsByMember.set(key, sockets);
  socket.join(roomId);
  if (!wasOnline) io.to(roomId).emit('user_joined', { username: member.name, userId: member.id, role: member.role, participants: await listOnlineParticipants(roomId) });

  for (const action of ['play', 'pause', 'seek', 'change_video'] as const) {
    socket.on(action, async (raw: unknown) => {
      const payloadSchema = action === 'seek' ? z.object({ time: z.number().finite().min(0).max(86_400) }) : action === 'change_video' ? z.object({ videoId: z.string().regex(/^[a-zA-Z0-9_-]{11}$/) }) : z.object({}).optional();
      const parsed = payloadSchema.safeParse(raw);
      if (!parsed.success) return emitError(socket, action === 'change_video' ? 'That YouTube link is not valid.' : 'That playback position is not valid.');
      try { await applyAction(roomId, code, member, action, parsed.data || {}); }
      catch (error) { emitError(socket, error instanceof Error ? error.message : 'That action could not be completed.'); }
    });
  }

  socket.on('request_change', async (raw: unknown) => {
    const parsed = requestSchema.safeParse(raw);
    if (!parsed.success) return emitError(socket, 'That request is not valid.');
    if (canControl(member)) return emitError(socket, 'You already have control of this room.');
    const now = Date.now();
    const requestTimes = (requestTimesByMember.get(memberSockets(roomId, member.id)) || []).filter((time) => now - time < 30_000);
    if (requestTimes.length >= 6) return emitError(socket, 'Please give the room a moment before sending another request.');
    if ([...pendingRequests.values()].filter((request) => request.roomId === roomId).length >= 100) return emitError(socket, 'The request list is full for a moment.');
    requestTimes.push(now);
    requestTimesByMember.set(memberSockets(roomId, member.id), requestTimes);
    const request: PendingRequest = { id: nanoid(10), roomId, userId: member.id, username: member.name, ...parsed.data, createdAt: Date.now() };
    pendingRequests.set(request.id, request);
    io.to(roomId).emit('room_request_created', request);
  });

  let lastChatAt = 0;
  socket.on('chat_message', async (raw: unknown) => {
    const parsed = z.object({ text: z.string().trim().min(1).max(500) }).safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Write a short message first.');
    if (Date.now() - lastChatAt < 450) return emitError(socket, 'Take a little breath between messages.');
    lastChatAt = Date.now();
    io.to(roomId).emit('chat_message', { name: member.name, text: parsed.data.text, at: new Date().toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) });
  });

  let lastSyncSave = 0;
  socket.on('sync_time', async (raw: unknown) => {
    const parsed = z.object({ time: z.number().finite().min(0).max(86_400) }).safeParse(raw);
    if (!parsed.success || !canControl(member)) return;
    const state = runtime.get(roomId);
    if (!state?.isPlaying) return;
    const nextState = { ...state, currentTime: parsed.data.time, updatedAt: Date.now() };
    if (Date.now() - lastSyncSave > 4_000) {
      lastSyncSave = Date.now();
      try {
        await persistState(roomId, nextState);
        io.to(roomId).emit('sync_state', await snapshot(roomId, code));
      } catch { emitError(socket, 'Could not save the playback position.'); }
    } else {
      runtime.set(roomId, nextState);
    }
  });

  socket.on('resolve_request', async (raw: unknown) => {
    const parsed = z.object({ requestId: z.string().min(1), approved: z.boolean() }).safeParse(raw);
    if (!parsed.success) return emitError(socket, 'That request could not be reviewed.');
    if (!canControl(member)) return emitError(socket, 'Only a Host or Moderator can review requests.');
    const request = pendingRequests.get(parsed.data.requestId);
    if (!request || request.roomId !== roomId) return emitError(socket, 'That request has expired.');
    if (parsed.data.approved) {
      try { await applyAction(roomId, code, member, request.action, request.payload || {}); }
      catch (error) { return emitError(socket, error instanceof Error ? error.message : 'That action could not be completed.'); }
    }
    pendingRequests.delete(request.id);
    io.to(roomId).emit('request_resolved', { requestId: request.id, userId: request.userId, action: request.action, approved: parsed.data.approved });
  });

  socket.on('assign_role', async (raw: unknown) => {
    const parsed = z.object({ userId: z.string().min(1), role: z.enum(['participant', 'moderator']) }).safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Choose a valid room role.');
    if (member.role !== 'host') return emitError(socket, 'Only the Host can assign roles.');
    const result = await pool.query('UPDATE participants SET role = $3 WHERE room_id = $1 AND id = $2 AND id <> $4 RETURNING id, name, role', [roomId, parsed.data.userId, parsed.data.role, member.id]);
    if (!result.rows[0]) return emitError(socket, 'That participant is no longer in the room.');
    const changed = result.rows[0] as Member;
    const changedKey = memberSockets(roomId, changed.id);
    for (const id of socketIdsByMember.get(changedKey) || []) {
      const target = io.sockets.sockets.get(id);
      if (target) {
        (target.data.auth as AuthData).member.role = changed.role;
        target.emit('pending_requests', canControl(changed) ? [...pendingRequests.values()].filter((request) => request.roomId === roomId) : []);
      }
    }
    io.to(roomId).emit('role_assigned', { userId: changed.id, username: changed.name, role: changed.role, participants: await listOnlineParticipants(roomId) });
    io.to(roomId).emit('sync_state', await snapshot(roomId, code));
  });

  socket.on('remove_participant', async (raw: unknown) => {
    const parsed = z.object({ userId: z.string().min(1) }).safeParse(raw);
    if (!parsed.success) return emitError(socket, 'Choose a participant to remove.');
    if (member.role !== 'host') return emitError(socket, 'Only the Host can remove participants.');
    const result = await pool.query('DELETE FROM participants WHERE room_id = $1 AND id = $2 AND id <> $3 RETURNING id, name', [roomId, parsed.data.userId, member.id]);
    if (!result.rows[0]) return emitError(socket, 'That participant is no longer in the room.');
    const removed = result.rows[0] as { id: string; name: string };
    for (const id of socketIdsByMember.get(memberSockets(roomId, removed.id)) || []) io.sockets.sockets.get(id)?.emit('removed_from_room');
    socketIdsByMember.delete(memberSockets(roomId, removed.id));
    io.to(roomId).emit('participant_removed', { userId: removed.id, username: removed.name, participants: await listOnlineParticipants(roomId) });
  });

  socket.on('leave_room', () => socket.disconnect(true));
  socket.on('disconnect', async () => {
    const connections = socketIdsByMember.get(key);
    connections?.delete(socket.id);
    if (connections?.size === 0) {
      socketIdsByMember.delete(key);
      io.to(roomId).emit('user_left', { username: member.name, userId: member.id, participants: await listOnlineParticipants(roomId) });
    }
  });

  socket.emit('room_state', await snapshot(roomId, code));
  if (canControl(member)) socket.emit('pending_requests', [...pendingRequests.values()].filter((request) => request.roomId === roomId));
});

const port = Number(process.env.PORT || 4000);
await initializeDatabase();
server.listen(port, () => console.log(`Watchparty server listening on ${port}`));

process.on('SIGTERM', () => { server.close(); void pool.end(); });
