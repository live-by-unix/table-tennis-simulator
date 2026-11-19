# Multiplayer

## Matchmaking

1. Client connects to `/ws` (session cookie auth).
2. Sends `{type:"matchmaking:join", mode:"ranked"}`.
3. Server queue pairs players by rating with a window that grows the longer you wait (base ±100, +40/s, cap ±800).
4. On pair, both clients receive `matchmaking:found` with `matchId` + opponent info, then join via `match:join`.

## Private rooms

- `room:create` → returns `{roomId, code}`; share the code.
- Friend sends `room:join {code}` → host gets `room:player_joined`.
- Host sends REST `POST /api/v1/rooms/:id/start` or `room:start` → `room:match_started`.

## Live gameplay

- Clients send `input` (paddle pos/quat/vel/angVel, seq) at ~30 Hz and `serve` when serving.
- Server validates (bounds, speed caps, quaternion, rate limits), simulates at 60 Hz, broadcasts `state` snapshots at tick rate.
- Clients interpolate remote paddles and the ball ~120 ms in the past; own paddle is client-predicted.

## Disconnects

- WS close → player marked disconnected; sim continues with last paddle state.
- Reconnect: reconnect WS, send `match:join` → `markConnected`, grace resets.
- After `MATCH_DISCONNECT_GRACE_MS` (30 s) → forfeit; match recorded as `abandoned`, winner gets the win.

## Spectating

`match:join {matchId, spectate:true}` (no auth needed) → receives snapshots only, orbiting camera. Spectators cannot send input.

See [WEBSOCKETS.md](WEBSOCKETS.md) for the message protocol.
