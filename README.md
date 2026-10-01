# Watchparty

A small, room-based way to watch YouTube together. The room host and moderators control playback. Participants can suggest a playback change and a host or moderator approves it before it happens.

## Run locally

Requirements: Node.js 20+.

1. Install the dependencies with `npm install`.
2. Run `npm run dev`.

The React app runs at `http://localhost:5173` and the Express/Socket.IO server runs at `http://localhost:4000`. Vite proxies API and WebSocket traffic to the server. For a convenient local run, `npm run dev` starts PGlite, a PostgreSQL-compatible development database, and stores its files under the ignored `.local/postgres` directory. The server creates the required tables when it starts. `npm run db:init` can initialize the tables on their own.

To use a separately installed local PostgreSQL server instead, set `DATABASE_URL` in `.env` and run `npm run dev:postgres`.

## Production build

Run `npm run build`, then `npm start`. The Express server serves the compiled React app and the API from one origin. That keeps Socket.IO on a persistent Node process, which is needed for live room events.

### Render deployment

`render.yaml` describes the always-on Node service. Before deploying, create a PostgreSQL database in Render and set `DATABASE_URL` to its connection string in the web service's environment. `DATABASE_SSL=true` enables certificate-verified TLS; keep the provider's CA certificate trusted by Node. Set `CLIENT_ORIGIN` to the public app origin if the frontend is hosted separately. With the included single-service setup, the default is `https://watchparty.onrender.com`. Create an account to start or join a room. Configure `REDIS_URL` from a managed Redis-compatible service before scaling to multiple app instances; without it, Socket.IO's adapter is process-local.

The Render web service is configured on its always-on Starter plan, which may incur hosting charges. Check the current service and PostgreSQL pricing before provisioning anything.

The repository does not contain live deployment credentials or a provisioned database, so the public URL should be added here after the service and database are created:

**Live app:** _Add the deployed URL here._

## Architecture overview

- The React + TypeScript client embeds YouTube's IFrame Player API. It uses a small custom control bar so playback actions pass through the room server first.
- Express provides room creation, room joining, a health endpoint, and the built frontend. PostgreSQL stores room state and participant identity/roles.
- Socket.IO carries room state and user actions in both directions. Email/password accounts use scrypt password hashes and random session tokens; room sockets require both the account session and room-member token. Only token hashes are stored in PostgreSQL. Roles are looked up by the server for privileged actions.
- The host can promote participants to moderator or remove them. Moderators share playback and request-approval controls. Participant changes are queued as requests and are applied only after a host or moderator approves.
- While playback is running, the host or a moderator sends periodic playback-time updates. The server persists those updates and broadcasts the timestamp so new or lagging viewers can catch up.
- Chat and reactions are sent through the room socket. Host transfer updates the participant roles and room owner in one database transaction. Room state and pending playback requests are stored in PostgreSQL.
- The realtime domain includes `Room`, `Participant`, and `MessageHandler` classes. Redis Pub/Sub through the Socket.IO Redis adapter carries room broadcasts across app instances; PostgreSQL remains the source of truth for room state, membership, roles, and pending requests.

## Event and role flow

1. A client registers or signs in, then creates or joins a room over HTTP and receives account and room session tokens.
2. Socket.IO validates both tokens against their hashes in PostgreSQL, resolves the participant's real role, and adds that participant to the room.
3. A host or moderator's play, pause, seek, or video-change event is validated, saved, and broadcast as a fresh room snapshot.
4. A participant's requested action is sent to the host/moderator queue. The server applies the action only after an authorized approval event.
5. Role assignment and removal are host-only events. The server updates PostgreSQL and broadcasts the current participant list.
6. The host can transfer ownership to an online room participant; the server changes both participant roles and the room owner atomically. Room reactions are validated and broadcast to everyone.

## Code walkthrough

- `src/ui/App.tsx`: landing page, room entry, player, participant controls, and chat.
- `src/ui/styles.css`: responsive visual system and the warm editorial direction inspired by the supplied Nudge portfolio template; GSAP animates the entry elements. The landing illustration frames the people photograph served by the template's Framer CDN.
- `server/index.ts`: account and room HTTP routes, Socket.IO auth/adapter setup, role enforcement, host transfer, room events, and approval flow.
- `server/db/pool.ts`: PostgreSQL connection pool and schema initialization.
- `render.yaml`: starting point for a persistent Render web service. Add a database connection string in the deployment environment before going live.

## Important product limits

- The browser keeps account and room tokens in session storage; clearing that browser session requires signing in and rejoining.
- YouTube availability, region rules, embeds, and autoplay restrictions are controlled by YouTube and the browser. A viewer may need to interact with the player before sound can start.
- Room/role metadata, playback position, and pending requests persist in PostgreSQL. Presence is derived from connected sockets. For multiple instances, Redis shares Socket.IO broadcasts and remote socket discovery; use a load balancer configured for WebSocket upgrades and size PostgreSQL/Redis for the expected connection count.
- The assessment's 1,000+ concurrent-user target is a capacity goal, not a measured guarantee. Validate it with a load test on the selected hosting/database/Redis plans, and tune `PG_POOL_MAX` against the database connection limit (total pool capacity is instances × pool size). A connection pooler is recommended at higher instance counts.
- A single backend instance works without Redis. Multiple backend instances require `REDIS_URL`; the Redis adapter shares broadcasts and online-socket discovery across the instances.
# watchparty
