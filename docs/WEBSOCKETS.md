# WebSocket Protocol

Endpoint: `GET /ws` (upgrade). Auth via `tts_session` cookie (optional for spectate).
Origin must be in `ALLOWED_ORIGINS`.

All messages are JSON. Client→server messages use `type` discriminator; server→client likewise.

## Client → Server

| type | payload | notes |
|---|---|---|
| `hello` | — | (re)authenticate; server replies `hello` |
| `matchmaking:join` | `{mode:"ranked"\|"casual"}` | enter queue |
| `matchmaking:cancel` | — | leave queue |
| `match:join` | `{matchId, spectate?}` | join as player or spectator |
| `input` | `{seq, paddle:{pos,quat,vel,angVel,faceRadius}}` | paddle state @ ~30 Hz |
| `serve` | `{vel:{x,y,z}}` | serve attempt (server's turn only) |
| `room:create` | — | create private room |
| `room:join` | `{code}` | join by code |
| `room:start` | `{roomId}` | host starts match |
| `room:leave` | — | leave room |
| `ping` | — | keepalive → `pong` |

## Server → Client

| type | payload |
|---|---|
| `hello` | `{authed, user}` |
| `state` | full snapshot: phase, score, ball, paddles, spectators, yourSide, events[] |
| `matchmaking:queued` / `matchmaking:found` / `matchmaking:cancelled` | queue lifecycle |
| `room:created` `{roomId,code}` / `room:joined` / `room:player_joined` / `room:match_started` / `room:left` | rooms |
| `input_rejected` `{reason}` / `serve_rejected` `{reason}` / `error` | failures |
| `pong` | `{ts}` |

## Validation

- Paddle position bounded to play area; speed ≤ 18 m/s; angular velocity ≤ 60 rad/s; quaternion must be unit length; stale `seq` ignored; per-update displacement capped.
- Serve velocity magnitude 2–18 m/s, downward bias required.
- Clients never send scores, ball positions, or match results — only paddle input and serve intent.
