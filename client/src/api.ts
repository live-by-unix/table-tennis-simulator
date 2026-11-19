export interface User {
  id: string;
  username: string;
  rating: number;
  avatar: string | null;
  wins: number;
  losses: number;
}

export interface Profile extends User {
  current_streak: number;
  best_streak: number;
  created_at: string;
  matches_played: number | null;
  points_won: number | null;
  points_lost: number | null;
  longest_rally: number | null;
}

async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: body ? { "Content-Type": "application/json" } : undefined,
    body: body ? JSON.stringify(body) : undefined,
    credentials: "include",
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `HTTP ${res.status}`);
  }
  return data as T;
}

export const api = {
  register: (username: string, password: string) =>
    req<{ user: User }>("POST", "/api/v1/auth/register", { username, password }),
  login: (username: string, password: string) =>
    req<{ user: User }>("POST", "/api/v1/auth/login", { username, password }),
  logout: () => req<{ ok: boolean }>("POST", "/api/v1/auth/logout"),
  me: () => req<{ user: User | null }>("GET", "/api/v1/auth/me"),
  profile: () => req<{ profile: Profile | null }>("GET", "/api/v1/profile"),
  profileByName: (username: string) =>
    req<{ profile: Profile }>("GET", `/api/v1/profile/${encodeURIComponent(username)}`),
  updateProfile: (body: { avatar?: string | null; displayName?: string | null }) =>
    req<{ ok: boolean }>("PATCH", "/api/v1/profile", body),
  changePassword: (currentPassword: string, newPassword: string) =>
    req<{ ok: boolean }>("POST", "/api/v1/auth/change-password", { currentPassword, newPassword }),
  deleteAccount: (password: string) =>
    req<{ ok: boolean }>("DELETE", "/api/v1/auth/account", { password }),
  matches: () => req<{ matches: MatchRow[] }>("GET", "/api/v1/matches"),
  match: (id: string) =>
    req<{ match: MatchDetail; players: MatchPlayerRow[] }>("GET", `/api/v1/matches/${id}`),
  leaderboard: () =>
    req<{ players: LeaderboardRow[] }>("GET", "/api/v1/leaderboard"),
  myMatch: () =>
    req<{ match: MyMatch | null }>("GET", "/api/v1/me/match"),
  createRoom: () => req<{ roomId: string; code: string }>("POST", "/api/v1/rooms"),
  joinRoom: (code: string) =>
    req<{ roomId: string; code: string }>("POST", "/api/v1/rooms/join", { code }),
  startRoom: (roomId: string) =>
    req<{ matchId: string }>("POST", `/api/v1/rooms/${roomId}/start`),
  leaveRoom: () => req<{ ok: boolean }>("POST", "/api/v1/rooms/leave"),
  matchmakingStatus: () =>
    req<{ queued: boolean; mode?: string; waitedMs?: number }>("GET", "/api/v1/matchmaking/status"),
};

export interface MatchRow {
  id: string;
  mode: string;
  status: string;
  score_a: number;
  score_b: number;
  started_at: string;
  ended_at: string | null;
  duration_ms: number | null;
  winner_user_id: string | null;
  player_a: string;
  player_b: string;
}

export interface MatchDetail extends MatchRow {
  server_user_id: string;
  client_user_id: string;
}

export interface MatchPlayerRow {
  side: number;
  rating_before: number;
  rating_after: number;
  result: number;
  points_won: number;
  username: string;
  user_id: string;
}

export interface LeaderboardRow {
  id: string;
  username: string;
  rating: number;
  wins: number;
  losses: number;
  avatar: string | null;
}

export interface MyMatch {
  id: string;
  phase: string;
  score: [number, number];
  mode: string;
  finished: boolean;
  yourSide: 0 | 1 | null;
  players: { username: string; rating: number; connected: boolean; side: number }[];
}
