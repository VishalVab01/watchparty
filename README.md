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

`render.yaml` describes the always-on Node service. Before deploying, create a PostgreSQL database in Render and set `DATABASE_URL` to its connection string in the web service's environment. `DATABASE_SSL=true` enables certificate-verified TLS; keep the provider's CA certificate trusted by Node. Set `CLIENT_ORIGIN` to the public app origin if the frontend is hosted separately. With the included single-service setup, the default is `https://watchparty.onrender.com`.

The Render web service is configured on its always-on Starter plan, which may incur hosting charges. Check the current service and PostgreSQL pricing before provisioning anything.

The repository does not contain live deployment credentials or a provisioned database, so the public URL should be added here after the service and database are created:

**Live app:** _Add the deployed URL here._

## Architecture overview

- The React + TypeScript client embeds YouTube's IFrame Player API. It uses a small custom control bar so playback actions pass through the room server first.
- Express provides room creation, room joining, a health endpoint, and the built frontend. PostgreSQL stores room state and participant identity/roles.
- Socket.IO carries room state and user actions in both directions. The server authenticates each socket with a random, per-participant token; only a SHA-256 token hash is stored in PostgreSQL. Roles are looked up by the server and checked again for every privileged action.
- The host can promote participants to moderator or remove them. Moderators share playback and request-approval controls. Participant changes are queued as requests and are applied only after a host or moderator approves.
- While playback is running, the host or a moderator sends periodic playback-time updates. The server persists those updates and broadcasts the timestamp so new or lagging viewers can catch up.
- Chat is sent through the same room socket and is held in memory for the current session; room and role information is stored in PostgreSQL.

## Event and role flow

1. A client creates or joins a room over HTTP and receives a random session token.
2. Socket.IO checks the token against its hash in PostgreSQL, resolves the participant's real role, and adds that participant to the room.
3. A host or moderator's play, pause, seek, or video-change event is validated, saved, and broadcast as a fresh room snapshot.
4. A participant's requested action is sent to the host/moderator queue. The server applies the action only after an authorized approval event.
5. Role assignment and removal are host-only events. The server updates PostgreSQL and broadcasts the current participant list.

## Code walkthrough

- `src/ui/App.tsx`: landing page, room entry, player, participant controls, and chat.
- `src/ui/styles.css`: responsive visual system and the warm editorial direction inspired by the supplied Nudge portfolio template; GSAP animates the entry elements. The landing illustration frames the people photograph served by the template's Framer CDN.
- `server/index.ts`: HTTP routes, Socket.IO authentication, role enforcement, room events, and approval flow.
- `server/db/pool.ts`: PostgreSQL connection pool and schema initialization.
- `render.yaml`: starting point for a persistent Render web service. Add a database connection string in the deployment environment before going live.

## Important product limits

- Guests do not need accounts. The browser keeps a room token in session storage; clearing that browser session means joining again.
- YouTube availability, region rules, embeds, and autoplay restrictions are controlled by YouTube and the browser. A viewer may need to interact with the player before sound can start.
- Room/role metadata and the latest playback position persist in PostgreSQL. Presence and chat messages are live, in-memory Socket.IO state. A server restart disconnects everyone and clears chat, but room participants can reconnect with their session tokens.
- Each service process manages its connected sockets directly. Supporting multiple backend instances will require a shared Socket.IO adapter such as Redis and a shared online-presence store.
# watchparty
