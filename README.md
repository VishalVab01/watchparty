# Watchparty

Watchparty is a room-based app for watching YouTube videos with friends. A host starts a room, shares its code or invite link, and controls the shared player. Moderators can help run playback; participants can suggest changes for the room to approve.

**Live demo:** [watchparty-fl0x.onrender.com](https://watchparty-fl0x.onrender.com/)

## What it does

### Watch together

- Create a room or join one with a room code or invite link.
- Play YouTube videos in an embedded player using the YouTube IFrame Player API.
- Keep the current video, play/pause state, and playback position in sync for everyone in the room.
- Show the selected video’s YouTube thumbnail before playback and while the room is paused.
- Paste a YouTube URL to change the room’s video. The room starts the new video from the beginning.
- Start a room from any of the four featured videos on the home page.

### Give each person the right controls

- The room creator becomes the **Host**. New members join as **Participants**.
- The Host can promote a participant to **Moderator**, return them to Participant, remove them, or transfer the host role.
- Hosts and Moderators can play, pause, seek, change the video, and approve participant requests.
- Participants can watch and send playback or video-change requests. A Host or Moderator must approve a request before it changes the room.
- The server checks roles before applying privileged actions; hiding a control in the interface is not the only permission check.

### Hang out in the room

- See who is online and their current room role.
- Send short real-time chat messages and emoji reactions.
- Copy the invite link or room code from the room.

Chat and reactions are live room events and are not saved as message history. Account/session, room, participant, playback, and pending-request records are stored in PostgreSQL.

### Browse the project

The home page includes a four-video watchlist, stream-to-room buttons, an About page, and a separate How It Works page. The interface uses a responsive grid, custom cursor, smooth Lenis scrolling, and GSAP/ScrollTrigger entrance and card-stack animations. Reduced-motion preferences are respected for the main scroll and reveal effects.

## Run it locally

### Requirements

- Node.js 20 or newer
- npm

### Start the app with the local development database

```bash
npm install
npm run dev
```

This starts a local PGlite database and runs the API/WebSocket server and Vite client. The database files are written to `.local/postgres` (ignored by Git). The server creates its tables on startup.

- Website: [http://localhost:5173](http://localhost:5173)
- Express API and Socket.IO server: [http://localhost:4000](http://localhost:4000)
- Local PGlite PostgreSQL-compatible endpoint: `localhost:5433`

Create an account in the app, then start or join a room. Vite proxies `/api` and `/socket.io` to the local Express server.

### Use an installed PostgreSQL server instead

Create a database, copy `.env.example` to `.env`, and set `DATABASE_URL` to your local PostgreSQL connection string. For a local database that does not use TLS, leave `DATABASE_SSL` unset or set it to `false`.

```bash
npm run dev:postgres
```

`npm run dev:postgres` starts the client and application server against the PostgreSQL URL in `.env`; it does not start a database server. Tables are initialized when the app server starts. To initialize them separately, run:

```bash
npm run db:init
```

## Configuration

The included `.env.example` shows the basic server configuration. Do not commit `.env` or production credentials.

| Variable | Required | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | Yes for the server | PostgreSQL connection string. `npm run dev` supplies a local PGlite URL; external PostgreSQL and production need their own URL. |
| `PORT` | No | HTTP server port. Defaults to `4000`; hosting providers can supply this. |
| `CLIENT_ORIGIN` | No | Allowed browser origin for API and Socket.IO requests. Defaults to `http://localhost:5173`. |
| `DATABASE_SSL` | No | Set to `true` to use certificate-verified PostgreSQL TLS. The Render Blueprint currently sets this to `false` for its configured database connection. |
| `PG_POOL_MAX` | No | Maximum PostgreSQL connections per app instance. Defaults to `10`. |
| `REDIS_URL` | No | Redis connection for the Socket.IO Redis adapter when running multiple server instances. |
| `NODE_ENV` | No | Node environment; set to `production` for deployment. |
| `VITE_API_URL` | No | Optional API base URL for a separately hosted frontend. Defaults to same-origin requests. |
| `VITE_SOCKET_URL` | No | Optional Socket.IO server URL for a separately hosted frontend. Defaults to the current origin. |

`VITE_*` values are embedded in the client build. They are public configuration and must not contain secrets. When deploying the frontend and backend on separate origins, configure `CLIENT_ORIGIN`, `VITE_API_URL`, and `VITE_SOCKET_URL` to match those origins. The included Render setup serves both from one origin, so the two `VITE_*` values are not needed.

## Build and run in production mode

```bash
npm run build
npm start
```

The build type-checks both the client and server, compiles the server to `dist-server`, and builds the React app to `dist`. Express serves the built app, HTTP API, and Socket.IO from one persistent Node.js process. A persistent process is used because the room server maintains live WebSocket connections.

## Deploy on Render

The repository includes a [`render.yaml`](render.yaml) Blueprint describing a Node web service and PostgreSQL database. It is configured as a free demo setup; check Render’s current service limits before using it for anything that needs guaranteed uptime or capacity.

1. Push the repository to GitHub and create a Render Blueprint from it.
2. Review the web service and PostgreSQL resources described in `render.yaml` before creating them.
3. Confirm the web service receives `DATABASE_URL` from the database connection string and has `CLIENT_ORIGIN` set to the deployed app origin.
4. Let Render run `npm ci --include=dev && npm run build`, followed by `npm start`.
5. Open the public URL, create an account, and try the create-room and join-room flows in separate browser sessions.

The current demo is [https://watchparty-fl0x.onrender.com](https://watchparty-fl0x.onrender.com). The `CLIENT_ORIGIN` in the Blueprint is set to that origin. Update it if the service URL changes.

For a single instance, Redis is optional. Before running multiple backend instances, provide a managed Redis-compatible `REDIS_URL` so Socket.IO can broadcast across instances. Configure the hosting layer for WebSocket upgrades and size the database pool against the PostgreSQL connection limit.

## How the room sync works

1. A visitor registers or signs in through the Express API. Passwords are hashed with Node’s `scrypt`; the server returns a random account session token.
2. The signed-in account creates a room or joins one by code. The server stores the participant and a hash of the participant’s room token in PostgreSQL.
3. The browser connects to Socket.IO with the room code and both tokens. The server validates the account session and room membership, then reads the participant’s role from PostgreSQL.
4. When a Host or Moderator changes playback, the server validates the event and payload, persists the room state, and broadcasts a fresh snapshot to the room.
5. While a video is playing, the controlling client periodically reports its current position. The server saves the position every few seconds and shares it so viewers can catch up.
6. A Participant’s playback or video-change request is stored in the room request queue. An authorized Host or Moderator can approve or decline it.

Socket.IO provides event-based communication over WebSockets, with its transport fallback where WebSockets are unavailable. The server also validates event payloads with Zod. Room permissions are enforced on the server, including for direct or forged client events.

## HTTP and socket events

### HTTP endpoints

| Method and path | Purpose |
| --- | --- |
| `POST /api/auth/register` | Create an account and session. |
| `POST /api/auth/login` | Sign in and create a session. |
| `GET /api/auth/me` | Validate the current account session. |
| `POST /api/rooms` | Create a room; the creator becomes Host. |
| `POST /api/rooms/join` | Join an existing room by code as a Participant. |
| `GET /api/rooms/:code` | Check whether a room code exists. |
| `GET /api/health` | Check the server and database connection. |

### Socket events

| Direction | Events | Purpose |
| --- | --- | --- |
| Client to server | `play`, `pause`, `seek`, `change_video`, `sync_time` | Control playback or report its current position. |
| Client to server | `request_change`, `resolve_request` | Submit and review participant playback requests. |
| Client to server | `assign_role`, `remove_participant`, `transfer_host` | Host membership and role actions. |
| Client to server | `chat_message`, `reaction`, `leave_room` | Chat, send an emoji reaction, or leave. |
| Server to client | `room_state`, `sync_state` | Send the initial or updated playback snapshot. |
| Server to client | `user_joined`, `user_left`, `role_assigned`, `participant_removed`, `host_transferred` | Keep member lists and roles current. |
| Server to client | `room_request_created`, `pending_requests`, `request_resolved` | Keep the approval queue current. |
| Server to client | `chat_message`, `reaction`, `action_error` | Deliver room messages, reactions, or action errors. |

## Technology choices

| Area | Technology | How it is used |
| --- | --- | --- |
| Client | React 18, TypeScript | Landing page, account entry, room UI, player controls, chat, and participant controls. |
| Client build | Vite 6, `@vitejs/plugin-react` | Local development server, API/WebSocket proxy, and production client build. |
| Styling | Custom CSS, Tailwind CSS 3, PostCSS, Autoprefixer | Responsive styles and a small set of utility classes. |
| Motion | GSAP, ScrollTrigger, Lenis | Entrance and scroll-linked animations, card stacking, and smooth scrolling. |
| Icons | `lucide-react` | Interface icons. |
| API | Node.js 20+, Express 4, `cors`, `dotenv` | Authentication, room endpoints, static production hosting, and health checks. |
| Realtime | Socket.IO server and client | Authenticated room events, playback synchronization, presence, chat, requests, and reactions. |
| Data | PostgreSQL, `pg` | Accounts, account sessions, rooms, participants, playback state, and pending requests. |
| Local database | PGlite, `@electric-sql/pglite-socket` (`pglite-server`) | PostgreSQL-compatible database for the one-command local development setup. |
| Multi-instance realtime | Redis, `@socket.io/redis-adapter` | Cross-instance Socket.IO broadcasts when `REDIS_URL` is configured. |
| Validation and IDs | Zod, `nanoid` | Validate HTTP/socket payloads and create room/request IDs. |
| Security primitives | Node.js `crypto` | `scrypt` password hashing, random tokens, and SHA-256 token hashes. |
| Dev tooling | `tsx`, `concurrently`, TypeScript, React/Vite type packages | Run the TypeScript server, coordinate local processes, and type-check the client and server. |

The player uses YouTube’s external IFrame Player API. The site loads Manrope, DM Mono, Righteous, and Caveat from Google Fonts; some decorative images are also served from an external image CDN.

Passwords are stored as salted `scrypt` hashes. The server issues random account and room tokens, stores their SHA-256 hashes in PostgreSQL, and keeps the active tokens in the browser’s `sessionStorage`. Account sessions expire after 30 days.

## Project map

```text
src/
  main.tsx             React entry point
  ui/App.tsx           Pages, auth flow, room UI, YouTube player, and Socket.IO client
  ui/styles.css        Theme, responsive layout, and animations
server/
  index.ts             Express routes and Socket.IO room logic
  identity.ts          IDs, room codes, tokens, and token hashing
  db/pool.ts           PostgreSQL pool and idempotent schema initialization
  db/init.ts           Standalone database initialization command
public/assets/         Local logo, icon, and friends-photo assets
render.yaml            Render web service and database Blueprint
.env.example           Local environment variable example
```

The server defines `Room`, `Participant`, and `MessageHandler` classes to keep room identity, role checks, and message validation explicit. PostgreSQL is the source of truth for persisted room and account data; Socket.IO carries live changes between connected clients.

## Assessment coverage and current limits

| Assessment area | Implementation |
| --- | --- |
| Room creation and joining | Unique room codes, invite links, Host on creation, Participant on join. |
| YouTube and playback sync | Embedded player plus shared video, play/pause, seek, and periodic position updates. |
| WebSocket communication | Socket.IO room events and server-to-room snapshots. |
| Role-based access | Host, Moderator, and Participant with server-side checks and UI role updates. |
| Participant requests | Playback and video changes go through an approval queue. |
| Host actions | Assign Moderator, remove participant, and transfer Host. |
| Bonus features | Persistent room data, account sign-in, in-room chat, emoji reactions, and Redis adapter support. |
| Public deployment | Render configuration and live demo URL are included above. |

The assessment mentions a target of 1,000+ users, 100+ rooms, and 50+ people per room. Redis adapter support and a configurable PostgreSQL pool provide a starting point for scaling, but those numbers have **not** been load-tested or verified. Capacity will depend on the Render plan, database, Redis, network setup, and application instance count. Treat this as a showcase deployment, not a capacity guarantee.

## Scripts

| Command | Purpose |
| --- | --- |
| `npm run dev` | Start PGlite, Express/Socket.IO, and Vite for local development. |
| `npm run dev:services` | Start Express/Socket.IO and Vite using the configured database. |
| `npm run dev:postgres` | Alias for running the app against a configured PostgreSQL server. |
| `npm run db:init` | Create or update the application tables. |
| `npm run typecheck` | Type-check client and server TypeScript. |
| `npm run build` | Type-check and create production server/client builds. |
| `npm start` | Run the compiled production server. |
