import { api, User, Profile, MatchRow, LeaderboardRow, MyMatch } from "./api";
import { net } from "./net";
import { MatchView } from "./game/matchView";

export type Route =
  | { name: "landing" }
  | { name: "login" }
  | { name: "register" }
  | { name: "dashboard" }
  | { name: "play" }
  | { name: "room"; code?: string }
  | { name: "match"; matchId: string; spectate?: boolean }
  | { name: "profile"; username?: string }
  | { name: "leaderboard" };

export function parseHash(): Route {
  const h = location.hash.replace(/^#\/?/, "");
  const [path, qs] = h.split("?");
  const params = new URLSearchParams(qs ?? "");
  const seg = (path ?? "").split("/").filter(Boolean);
  switch (seg[0]) {
    case "login": return { name: "login" };
    case "register": return { name: "register" };
    case "play": return { name: "play" };
    case "room": return { name: "room", code: params.get("code") ?? seg[1] };
    case "match": return { name: "match", matchId: seg[1] ?? "", spectate: params.get("spectate") === "1" };
    case "profile": return { name: "profile", username: seg[1] };
    case "leaderboard": return { name: "leaderboard" };
    case "dashboard": return { name: "dashboard" };
    default: return { name: "landing" };
  }
}

export function navigate(r: Route): void {
  switch (r.name) {
    case "landing": location.hash = "#/"; break;
    case "login": location.hash = "#/login"; break;
    case "register": location.hash = "#/register"; break;
    case "dashboard": location.hash = "#/dashboard"; break;
    case "play": location.hash = "#/play"; break;
    case "room": location.hash = r.code ? `#/room?code=${r.code}` : "#/room"; break;
    case "match": location.hash = `#/match/${r.matchId}${r.spectate ? "?spectate=1" : ""}`; break;
    case "profile": location.hash = r.username ? `#/profile/${r.username}` : "#/profile"; break;
    case "leaderboard": location.hash = "#/leaderboard"; break;
  }
}

let currentUser: User | null = null;
let currentMatchView: MatchView | null = null;

export function getUser(): User | null { return currentUser; }
export async function refreshUser(): Promise<User | null> {
  try {
    const { user } = await api.me();
    currentUser = user;
  } catch { currentUser = null; }
  return currentUser;
}
export function setUser(u: User | null): void { currentUser = u; }

function shell(inner: string, active?: string): string {
  const u = currentUser;
  const links = u
    ? `<a href="#/dashboard" class="${active === "dashboard" ? "active" : ""}">Dashboard</a>
       <a href="#/play" class="${active === "play" ? "active" : ""}">Play</a>
       <a href="#/leaderboard" class="${active === "leaderboard" ? "active" : ""}">Leaderboard</a>
       <a href="#/profile" class="${active === "profile" ? "active" : ""}">${escapeHtml(u.username)}</a>
       <a href="#" id="nav-logout">Logout</a>`
    : `<a href="#/leaderboard" class="${active === "leaderboard" ? "active" : ""}">Leaderboard</a>
       <a href="#/login">Login</a><a href="#/register" class="btn-link">Register</a>`;
  return `<nav class="navbar">
    <a class="logo" href="#/">🏓 Table Tennis</a>
    <div class="nav-links">${links}</div>
  </nav><div class="container" id="page">${inner}</div>`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!);
}

function toast(msg: string, isErr = false): void {
  const t = document.createElement("div");
  t.className = "toast" + (isErr ? " error" : "");
  t.textContent = msg;
  document.body.appendChild(t);
  setTimeout(() => t.remove(), 4000);
}

export function cleanupMatch(): void {
  currentMatchView?.dispose();
  currentMatchView = null;
}

// ---------------- pages ----------------

async function renderLanding(app: HTMLElement): Promise<void> {
  app.innerHTML = shell(`
    <div class="hero">
      <h1>🏓 Table Tennis Simulator</h1>
      <p>A real-time multiplayer 3D table tennis game. Compete in ranked matches,
         create private rooms with friends, and climb the global leaderboard.
         Fully self-hostable — your data stays on your server.</p>
      <div class="btn-row">
        ${currentUser
          ? `<button onclick="location.hash='#/play'">Play Now</button>
             <button class="secondary" onclick="location.hash='#/leaderboard'">Leaderboard</button>`
          : `<button onclick="location.hash='#/register'">Get Started</button>
             <button class="secondary" onclick="location.hash='#/login'">Login</button>`}
      </div>
    </div>
    <div class="grid cols-3 mt">
      <div class="card"><h3>Real Physics</h3><p class="muted">Server-authoritative ball physics with spin, Magnus effect, and realistic table bounces.</p></div>
      <div class="card"><h3>True Multiplayer</h3><p class="muted">WebSocket-powered real-time matches with matchmaking, private rooms, and spectators.</p></div>
      <div class="card"><h3>Self-Hosted</h3><p class="muted">Run your own instance with Docker. No external services required.</p></div>
    </div>`);
  bindNav(app);
}

async function renderAuth(app: HTMLElement, mode: "login" | "register"): Promise<void> {
  const isReg = mode === "register";
  app.innerHTML = shell(`
    <div class="card" style="max-width:420px;margin:40px auto">
      <h2 class="mb">${isReg ? "Create Account" : "Login"}</h2>
      <div class="col">
        <input id="au-user" placeholder="Username" autocomplete="username" />
        <input id="au-pass" type="password" placeholder="Password ${isReg ? "(min 8 chars)" : ""}" autocomplete="${isReg ? "new-password" : "current-password"}" />
        <div id="au-err" class="muted" style="color:var(--danger)"></div>
        <button id="au-btn">${isReg ? "Register" : "Login"}</button>
        <p class="muted center">${isReg ? 'Already have an account? <a href="#/login">Login</a>' : 'No account? <a href="#/register">Register</a>'}</p>
      </div>
    </div>`);
  bindNav(app);
  const btn = app.querySelector("#au-btn") as HTMLButtonElement;
  btn.onclick = async () => {
    const username = (app.querySelector("#au-user") as HTMLInputElement).value.trim();
    const password = (app.querySelector("#au-pass") as HTMLInputElement).value;
    const errEl = app.querySelector("#au-err") as HTMLElement;
    errEl.textContent = "";
    btn.disabled = true;
    try {
      const res = isReg ? await api.register(username, password) : await api.login(username, password);
      setUser(res.user);
      // reconnect so the WS handshake carries the new session cookie
      net.disconnect();
      net.connect();
      navigate({ name: "dashboard" });
    } catch (e) {
      errEl.textContent = (e as Error).message;
      btn.disabled = false;
    }
  };
  (app.querySelector("#au-pass") as HTMLInputElement).addEventListener("keydown", (e) => {
    if (e.key === "Enter") btn.click();
  });
}

async function renderDashboard(app: HTMLElement): Promise<void> {
  const [profileRes, matchesRes, lbRes] = await Promise.all([
    api.profile().catch(() => ({ profile: null })),
    api.matches().catch(() => ({ matches: [] as MatchRow[] })),
    api.leaderboard().catch(() => ({ players: [] as LeaderboardRow[] })),
  ]);
  const p = profileRes.profile as Profile | null;
  const matches = matchesRes.matches.slice(0, 5);
  const top = lbRes.players.slice(0, 5);
  const winRate = p && p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
  app.innerHTML = shell(`
    <h1 class="mb">Welcome, ${escapeHtml(currentUser?.username ?? "")}</h1>
    <div class="grid cols-2">
      <div class="card">
        <h3 class="mb">Your Stats</h3>
        <div class="stat"><span class="muted">Rating</span><b>${p?.rating ?? "-"}</b></div>
        <div class="stat"><span class="muted">Record</span><b>${p?.wins ?? 0}W / ${p?.losses ?? 0}L</b></div>
        <div class="stat"><span class="muted">Win Rate</span><b>${winRate}%</b></div>
        <div class="stat"><span class="muted">Streak</span><b>${p?.current_streak ?? 0} (best ${p?.best_streak ?? 0})</b></div>
        <div class="stat"><span class="muted">Matches</span><b>${p?.matches_played ?? 0}</b></div>
        <div class="row mt"><button onclick="location.hash='#/play'">Play</button>
        <button class="secondary" onclick="location.hash='#/profile'">Profile</button></div>
      </div>
      <div class="card">
        <h3 class="mb">Recent Matches</h3>
        ${matches.length === 0 ? '<p class="muted">No matches yet. <a href="#/play">Play your first match!</a></p>' :
          matches.map((m) => matchRowHtml(m, currentUser?.id ?? "")).join("")}
      </div>
    </div>
    <div class="card mt">
      <h3 class="mb">Top Players</h3>
      ${top.length === 0 ? '<p class="muted">No players yet.</p>' :
        `<table><tr><th>#</th><th>Player</th><th>Rating</th><th>W/L</th></tr>` +
        top.map((pl, i) => `<tr><td>${i + 1}</td><td>${escapeHtml(pl.username)}</td><td>${pl.rating}</td><td>${pl.wins}/${pl.losses}</td></tr>`).join("") + `</table>`}
      <p class="mt"><a href="#/leaderboard">View full leaderboard →</a></p>
    </div>`);
  bindNav(app);
}

function matchRowHtml(m: MatchRow, myId: string): string {
  const iWon = m.winner_user_id === myId;
  const opponent = m.player_a === currentUser?.username ? m.player_b : m.player_a;
  const score = `${m.score_a} : ${m.score_b}`;
  return `<div class="stat" style="cursor:pointer" onclick="location.hash='#/match-detail/${m.id}'">
    <span><span class="badge ${iWon ? "win" : "loss"}">${iWon ? "W" : "L"}</span>
    vs ${escapeHtml(opponent)} <span class="muted">· ${m.mode}</span></span>
    <span class="muted">${score} · ${new Date(m.started_at).toLocaleDateString()}</span></div>`;
}

async function renderPlay(app: HTMLElement): Promise<void> {
  // check for live match
  const { match } = await api.myMatch().catch(() => ({ match: null as MyMatch | null }));
  if (match && !match.finished) {
    navigate({ name: "match", matchId: match.id });
    return;
  }
  app.innerHTML = shell(`
    <h1 class="mb">Play <span id="conn-status" class="muted" style="font-size:14px"></span></h1>
    <div class="grid cols-2">
      <div class="card">
        <h3 class="mb">Ranked Matchmaking</h3>
        <p class="muted mb">Get matched with a player of similar rating.</p>
        <div id="mm-status" class="mb"></div>
        <div class="row">
          <button id="mm-join">Find Match</button>
          <button id="mm-cancel" class="secondary hidden">Cancel</button>
        </div>
      </div>
      <div class="card">
        <h3 class="mb">Private Match</h3>
        <p class="muted mb">Create a room and share the code with a friend.</p>
        <div id="room-area">
          <div class="row">
            <button id="room-create">Create Room</button>
          </div>
          <div class="row mt">
            <input id="room-code" placeholder="Enter room code" style="text-transform:uppercase" />
            <button id="room-join" class="secondary">Join</button>
          </div>
          <div id="room-info" class="mt"></div>
        </div>
      </div>
    </div>
    <div class="card mt">
      <h3 class="mb">Spectate</h3>
      <p class="muted mb">Enter a match ID to watch (players receive it after match start).</p>
      <div class="row">
        <input id="spec-id" placeholder="Match ID (UUID)" style="max-width:380px" />
        <button id="spec-go" class="secondary">Watch</button>
      </div>
    </div>`);
  bindNav(app);

  const connEl = app.querySelector("#conn-status") as HTMLElement;
  const updateConn = () => {
    connEl.textContent = net.connected
      ? (net.authed ? "· connected" : "· connected (not logged in)")
      : "· connecting…";
    connEl.style.color = net.connected ? "var(--accent2)" : "var(--danger)";
  };
  updateConn();
  net.onMessage((msg) => { if (msg.type === "_connected" || msg.type === "_disconnected" || msg.type === "hello") updateConn(); });

  const statusEl = app.querySelector("#mm-status") as HTMLElement;
  const joinBtn = app.querySelector("#mm-join") as HTMLButtonElement;
  const cancelBtn = app.querySelector("#mm-cancel") as HTMLButtonElement;

  let roomRole: "host" | "guest" | null = null;
  let roomId: string | null = null;
  const unsub = net.onMessage((msg) => {
    if (msg.type === "matchmaking:queued") {
      statusEl.innerHTML = '<div class="spinner" style="width:28px;height:28px"></div><p class="center muted">Searching for opponent…</p>';
      joinBtn.classList.add("hidden");
      cancelBtn.classList.remove("hidden");
    } else if (msg.type === "matchmaking:found") {
      statusEl.innerHTML = `<p class="center">Match found vs <b>${escapeHtml((msg.opponent as { username: string }).username)}</b>! Joining…</p>`;
      cancelBtn.classList.add("hidden");
      navigate({ name: "match", matchId: msg.matchId as string });
    } else if (msg.type === "matchmaking:cancelled") {
      statusEl.innerHTML = "";
      joinBtn.classList.remove("hidden");
      cancelBtn.classList.add("hidden");
    } else if (msg.type === "error") {
      if (statusEl.innerHTML.includes("Searching")) {
        statusEl.innerHTML = `<p style="color:var(--danger)">${escapeHtml(msg.error as string)}</p>`;
        joinBtn.classList.remove("hidden");
        cancelBtn.classList.add("hidden");
      } else {
        toast(msg.error as string, true);
      }
    }
    if (msg.type === "room:created") {
      roomRole = "host";
      roomId = msg.roomId as string;
      (app.querySelector("#room-info") as HTMLElement).innerHTML =
        `<p>Room code: <b style="font-size:22px;letter-spacing:2px">${escapeHtml(msg.code as string)}</b></p>
         <p class="muted">Share this code. Waiting for opponent…</p>`;
    } else if (msg.type === "room:joined") {
      roomRole = "guest";
      roomId = msg.roomId as string;
      (app.querySelector("#room-info") as HTMLElement).innerHTML =
        `<p>Joined room <b>${escapeHtml(msg.code as string)}</b></p>
         <p class="muted">Waiting for host to start the match…</p>`;
    } else if (msg.type === "room:player_joined") {
      if (roomRole === "host") {
        (app.querySelector("#room-info") as HTMLElement).innerHTML =
          `<p>${escapeHtml((msg.player as { username: string }).username)} joined!</p>
           <button id="room-start">Start Match</button>`;
        (app.querySelector("#room-start") as HTMLButtonElement).onclick = async () => {
          try {
            const res = await api.startRoom(msg.roomId as string);
            navigate({ name: "match", matchId: res.matchId });
          } catch (e) { toast((e as Error).message, true); }
        };
      } else {
        (app.querySelector("#room-info") as HTMLElement).innerHTML =
          `<p>${escapeHtml((msg.player as { username: string }).username)} joined the room.</p>
           <p class="muted">Waiting for host to start…</p>`;
      }
    } else if (msg.type === "room:match_started") {
      navigate({ name: "match", matchId: msg.matchId as string });
    } else if (msg.type === "room:left") {
      roomRole = null; roomId = null;
      (app.querySelector("#room-info") as HTMLElement).innerHTML = "";
    }
  });
  app.addEventListener("hashchange", () => unsub(), { once: true });

  joinBtn.onclick = () => {
    net.send({ type: "matchmaking:join", mode: "ranked" });
  };
  cancelBtn.onclick = () => net.send({ type: "matchmaking:cancel" });

  (app.querySelector("#room-create") as HTMLButtonElement).onclick = () => {
    net.send({ type: "room:create" });
  };
  (app.querySelector("#room-join") as HTMLButtonElement).onclick = async () => {
    const code = (app.querySelector("#room-code") as HTMLInputElement).value.trim();
    if (!code) return;
    try {
      const jr = await api.joinRoom(code);
      roomRole = "guest";
      roomId = jr.roomId;
      (app.querySelector("#room-info") as HTMLElement).innerHTML =
        `<p>Joined room <b>${escapeHtml(jr.code)}</b></p>
         <p class="muted">Waiting for host to start the match…</p>`;
      toast("Joined room!");
    } catch (e) { toast((e as Error).message, true); }
  };
  (app.querySelector("#spec-go") as HTMLButtonElement).onclick = () => {
    const id = (app.querySelector("#spec-id") as HTMLInputElement).value.trim();
    if (id) navigate({ name: "match", matchId: id, spectate: true });
  };
}

async function renderMatch(app: HTMLElement, matchId: string, spectate: boolean): Promise<void> {
  cleanupMatch();
  app.innerHTML = shell(`
    <div id="game-container"></div>
    <div class="row mt"><button class="secondary" id="back-btn">Back to Dashboard</button></div>`);
  bindNav(app);
  (app.querySelector("#back-btn") as HTMLButtonElement).onclick = () => {
    cleanupMatch();
    navigate({ name: "dashboard" });
  };
  const container = app.querySelector("#game-container") as HTMLElement;
  currentMatchView = new MatchView(container, matchId, spectate);
  currentMatchView.onExit = () => navigate({ name: "dashboard" });
  currentMatchView.onMatchEnd = (snap) => {
    setTimeout(() => {
      toast(snap.winner === snap.yourSide ? "Victory!" : "Defeat");
    }, 1200);
  };
}

async function renderProfile(app: HTMLElement, username?: string): Promise<void> {
  let p: Profile | null = null;
  try {
    const res = username ? await api.profileByName(username) : await api.profile();
    p = res.profile as Profile;
  } catch (e) {
    app.innerHTML = shell(`<div class="card"><p style="color:var(--danger)">${escapeHtml((e as Error).message)}</p></div>`);
    bindNav(app);
    return;
  }
  const winRate = p && p.wins + p.losses > 0 ? Math.round((p.wins / (p.wins + p.losses)) * 100) : 0;
  const isMe = p.username === currentUser?.username;
  app.innerHTML = shell(`
    <div class="grid cols-2">
      <div class="card center">
        <div style="font-size:64px">${p.avatar ? `<img src="${escapeHtml(p.avatar)}" style="width:80px;height:80px;border-radius:50%" />` : "🏓"}</div>
        <h2>${escapeHtml(p.username)}</h2>
        <p class="muted">Rating ${p.rating}</p>
        <div class="row mt" style="justify-content:center">
          <div class="stat" style="border:none"><b>${p.wins}</b><br><span class="muted">Wins</span></div>
          <div class="stat" style="border:none"><b>${p.losses}</b><br><span class="muted">Losses</span></div>
          <div class="stat" style="border:none"><b>${winRate}%</b><br><span class="muted">Win%</span></div>
          <div class="stat" style="border:none"><b>${p.current_streak}</b><br><span class="muted">Streak</span></div>
        </div>
        ${isMe ? `
        <div class="mt" style="text-align:left">
          <label class="muted">Avatar URL</label>
          <input id="pf-avatar" value="${escapeHtml(p.avatar ?? "")}" placeholder="https://… (optional)" />
          <div class="row mt"><button id="pf-save">Save</button></div>
        </div>` : ""}
      </div>
      <div class="card">
        <h3 class="mb">Statistics</h3>
        <div class="stat"><span class="muted">Matches played</span><b>${p.matches_played ?? 0}</b></div>
        <div class="stat"><span class="muted">Points won</span><b>${p.points_won ?? 0}</b></div>
        <div class="stat"><span class="muted">Points lost</span><b>${p.points_lost ?? 0}</b></div>
        <div class="stat"><span class="muted">Longest rally</span><b>${p.longest_rally ?? 0}</b></div>
        <div class="stat"><span class="muted">Best streak</span><b>${p.best_streak}</b></div>
        <div class="stat"><span class="muted">Member since</span><b>${new Date(p.created_at).toLocaleDateString()}</b></div>
      </div>
    </div>`);
  bindNav(app);
  if (isMe) {
    (app.querySelector("#pf-save") as HTMLButtonElement).onclick = async () => {
      const avatar = (app.querySelector("#pf-avatar") as HTMLInputElement).value.trim() || null;
      try {
        await api.updateProfile({ avatar });
        toast("Profile updated");
      } catch (e) { toast((e as Error).message, true); }
    };
  }
}

async function renderLeaderboard(app: HTMLElement): Promise<void> {
  let players: LeaderboardRow[] = [];
  try {
    players = (await api.leaderboard()).players;
  } catch { /* ignore */ }
  app.innerHTML = shell(`
    <h1 class="mb">Leaderboard</h1>
    <div class="card"><div class="table-wrap"><table>
      <tr><th>Rank</th><th>Player</th><th>Rating</th><th>Wins</th><th>Losses</th><th>Win Rate</th></tr>
      ${players.map((pl, i) => {
        const wr = pl.wins + pl.losses > 0 ? Math.round((pl.wins / (pl.wins + pl.losses)) * 100) : 0;
        const me = pl.username === currentUser?.username ? " <span class='badge live'>you</span>" : "";
        return `<tr><td>${i + 1}</td><td><a href="#/profile/${encodeURIComponent(pl.username)}">${escapeHtml(pl.username)}</a>${me}</td><td>${pl.rating}</td><td>${pl.wins}</td><td>${pl.losses}</td><td>${wr}%</td></tr>`;
      }).join("")}
    </table></div>
    ${players.length === 0 ? '<p class="muted center mt">No players yet — be the first!</p>' : ""}
    </div>`);
  bindNav(app);
}

async function renderMatchDetail(app: HTMLElement, matchId: string): Promise<void> {
  try {
    const { match, players } = await api.match(matchId);
    app.innerHTML = shell(`
      <h1 class="mb">Match Detail</h1>
      <div class="card">
        <div class="center mb">
          <div class="big">${match.score_a} : ${match.score_b}</div>
          <p class="muted">${match.mode} · ${match.status} · ${new Date(match.started_at).toLocaleString()}</p>
        </div>
        <table>
          <tr><th>Player</th><th>Side</th><th>Rating Before</th><th>Rating After</th><th>Points</th><th>Result</th></tr>
          ${players.map((p) => `<tr>
            <td>${escapeHtml(p.username)}</td><td>${p.side === 0 ? "A" : "B"}</td>
            <td>${p.rating_before ?? "-"}</td><td>${p.rating_after ?? "-"}</td>
            <td>${p.points_won}</td>
            <td><span class="badge ${p.result === 1 ? "win" : "loss"}">${p.result === 1 ? "Win" : "Loss"}</span></td>
          </tr>`).join("")}
        </table>
        ${match.status === "live" ? `<p class="mt"><a href="#/match/${match.id}">Watch live →</a></p>` : ""}
        <p class="mt muted">Duration: ${match.duration_ms ? Math.round(match.duration_ms / 1000) + "s" : "-"}</p>
      </div>`);
  } catch (e) {
    app.innerHTML = shell(`<div class="card"><p style="color:var(--danger)">${escapeHtml((e as Error).message)}</p></div>`);
  }
  bindNav(app);
}

function bindNav(app: HTMLElement): void {
  const logout = app.querySelector("#nav-logout");
  if (logout) {
    logout.addEventListener("click", async (e) => {
      e.preventDefault();
      await api.logout().catch(() => {});
      setUser(null);
      net.disconnect();
      navigate({ name: "landing" });
    });
  }
}

export async function render(app: HTMLElement): Promise<void> {
  cleanupMatch();
  const route = parseHash();
  // redirect protected routes
  if (["dashboard", "play", "profile", "room"].includes(route.name) && !currentUser) {
    location.hash = "#/login";
    return;
  }
  switch (route.name) {
    case "landing": await renderLanding(app); break;
    case "login": await renderAuth(app, "login"); break;
    case "register": await renderAuth(app, "register"); break;
    case "dashboard": await renderDashboard(app); break;
    case "play": await renderPlay(app); break;
    case "room": await renderPlay(app); break; // room handled inside play page
    case "match": await renderMatch(app, route.matchId, !!route.spectate); break;
    case "profile": await renderProfile(app, route.username); break;
    case "leaderboard": await renderLeaderboard(app); break;
    default: await renderLanding(app);
  }
  // match detail pseudo-route
  const h = location.hash;
  if (h.startsWith("#/match-detail/")) {
    await renderMatchDetail(app, h.split("/")[2] ?? "");
  }
}
