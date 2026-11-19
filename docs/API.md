# REST API — `/api/v1`

All endpoints return JSON. Auth via `tts_session` HttpOnly cookie. Errors: `{error: string}` with appropriate HTTP status.

## Health

`GET /health` → `{ok, ts}` (no auth)

## Auth

| Method | Path | Body | Response |
|---|---|---|---|
| POST | `/auth/register` | `{username, password}` | `{user}` + cookie |
| POST | `/auth/login` | `{username, password}` | `{user}` + cookie |
| POST | `/auth/logout` | — | `{ok}` |
| GET | `/auth/me` | — | `{user\|null}` |
| POST | `/auth/change-password` | `{currentPassword, newPassword}` | `{ok}` (all sessions revoked) |
| DELETE | `/auth/account` | `{password}` | `{ok}` (soft delete) |

Username: 3–20 chars `[a-zA-Z0-9_]`. Password: 8–128 chars.

## Profile

| Method | Path | Notes |
|---|---|---|
| GET | `/profile` | own full profile + stats (auth) |
| GET | `/profile/:username` | public profile |
| PATCH | `/profile` | `{avatar?, displayName?}` (auth) |

## Matches

| Method | Path | Notes |
|---|---|---|
| GET | `/matches` | own match history (latest 50, auth) |
| GET | `/matches/:id` | match detail + per-player ratings (participants; finished matches readable) |
| GET | `/me/match` | current live match for rejoin (auth) |

## Matchmaking (REST helpers; queue itself is over WS)

| Method | Path | Notes |
|---|---|---|
| POST | `/matchmaking/join` | `{mode}` — see note |
| POST | `/matchmaking/cancel` | leave queue |
| GET | `/matchmaking/status` | queue state |

Note: actual pairing requires the WebSocket connection (the queue entry carries the live socket).

## Private rooms

| Method | Path | Notes |
|---|---|---|
| POST | `/rooms` | create room (requires active WS conn) → `{roomId, code}` |
| POST | `/rooms/join` | `{code}` → `{roomId, code}` |
| POST | `/rooms/:id/start` | host only → `{matchId}` |
| POST | `/rooms/leave` | leave current room |

## Leaderboard

`GET /leaderboard` → `{players: [{id, username, rating, wins, losses, avatar}]}` top 100.
