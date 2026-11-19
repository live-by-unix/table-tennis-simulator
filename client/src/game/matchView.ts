import * as THREE from "three";
import { buildWorld } from "./world";
import { TABLE, BALL_RADIUS, PADDLE_FACE_RADIUS, GameSnapshot, SnapPaddle } from "./constants";
import { net } from "../net";

interface Vec3 { x: number; y: number; z: number }

const INPUT_HZ = 30;
const INTERP_DELAY = 0.12; // seconds behind latest snapshot

interface PaddleMesh {
  group: THREE.Group;
  blade: THREE.Mesh;
  handle: THREE.Mesh;
}

function makePaddleMesh(color: number): PaddleMesh {
  const group = new THREE.Group();
  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.4, metalness: 0.3 });
  const rubberMat = new THREE.MeshStandardMaterial({ color, roughness: 0.85 });
  const blade = new THREE.Mesh(new THREE.CylinderGeometry(PADDLE_FACE_RADIUS, PADDLE_FACE_RADIUS, 0.012, 24), [bladeMat, rubberMat, bladeMat]);
  blade.rotation.x = Math.PI / 2; // cylinder axis -> z (face normal)
  blade.castShadow = true;
  const handle = new THREE.Mesh(
    new THREE.CylinderGeometry(0.014, 0.017, 0.11, 10),
    new THREE.MeshStandardMaterial({ color: 0x7c4a21, roughness: 0.8 }),
  );
  handle.rotation.x = Math.PI / 2;
  handle.position.set(0, -PADDLE_FACE_RADIUS - 0.05, 0.02);
  handle.castShadow = true;
  group.add(blade, handle);
  return { group, blade, handle };
}

function quatToThree(q: [number, number, number, number]): THREE.Quaternion {
  return new THREE.Quaternion(q[0], q[1], q[2], q[3]);
}

export class MatchView {
  private renderer: THREE.WebGLRenderer;
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private container: HTMLElement;
  private matchId: string;
  private spectate: boolean;

  private ball!: THREE.Mesh;
  private paddles: (PaddleMesh | null)[] = [null, null];
  private paddleNames: (string | null)[] = [null, null];

  // local paddle state (player only)
  private localPos = new THREE.Vector3(-1.8, 1.1, 0);
  private localVel = new THREE.Vector3();
  private lastLocalPos = new THREE.Vector3();
  private targetZ = 0;
  private targetY = 1.1;
  private depthOffset = 0; // manual depth adjustment -1..1
  private keys = new Set<string>();
  private seq = 0;
  private lastSend = 0;
  private sensitivity = 1.0;
  private invertY = false;

  // snapshot interpolation
  private history: { t: number; snap: GameSnapshot }[] = [];
  private latest: GameSnapshot | null = null;
  private mySide: 0 | 1 | null = null;
  private remotePaddleHist: Record<number, { t: number; p: SnapPaddle }[]> = { 0: [], 1: [] };

  private raf = 0;
  private lastT = 0;
  private disposed = false;
  private unsub: (() => void) | null = null;

  // HUD elements
  private hudScore!: HTMLElement;
  private hudNames!: HTMLElement;
  private hudPhase!: HTMLElement;
  private hudSpec!: HTMLElement;
  private hudServe!: HTMLElement;
  private hudConns!: HTMLElement[];

  onExit: (() => void) | null = null;
  onMatchEnd: ((snap: GameSnapshot) => void) | null = null;

  constructor(container: HTMLElement, matchId: string, spectate = false) {
    this.container = container;
    this.matchId = matchId;
    this.spectate = spectate;

    this.renderer = new THREE.WebGLRenderer({ antialias: true });
    this.renderer.setPixelRatio(Math.min(devicePixelRatio, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    container.appendChild(this.renderer.domElement);

    const world = buildWorld();
    this.scene = world.scene;
    this.camera = new THREE.PerspectiveCamera(60, 1, 0.1, 60);

    // ball
    this.ball = new THREE.Mesh(
      new THREE.SphereGeometry(BALL_RADIUS, 20, 14),
      new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35 }),
    );
    this.ball.castShadow = true;
    this.scene.add(this.ball);

    // paddle meshes
    const p0 = makePaddleMesh(0xe11d48);
    const p1 = makePaddleMesh(0x2563eb);
    p0.group.visible = false;
    p1.group.visible = false;
    this.scene.add(p0.group, p1.group);
    this.paddles = [p0, p1];

    this.resize();
    window.addEventListener("resize", this.resize);
    this.bindInput();
    this.buildHud();
    this.unsub = net.onMessage((msg) => this.handleNet(msg));

    net.send({ type: "match:join", matchId, spectate });
    this.lastT = performance.now();
    this.raf = requestAnimationFrame(this.loop);
  }

  private buildHud(): void {
    const wrap = document.createElement("div");
    wrap.innerHTML = `
      <div class="hud-top">
        <div style="text-align:center"><div class="hud-name" id="mv-name0">-</div><div class="hud-score" id="mv-score0">0</div></div>
        <div class="muted" style="font-size:20px">:</div>
        <div style="text-align:center"><div class="hud-name" id="mv-name1">-</div><div class="hud-score" id="mv-score1">0</div></div>
      </div>
      <div class="hud-phase" id="mv-phase"></div>
      <div class="spectator-count" id="mv-spec"></div>
      <div class="serve-hint hidden" id="mv-serve">Click or press Space to serve</div>
      <div class="hud-bottom">
        <span class="muted" style="font-size:13px">Sensitivity</span>
        <input type="range" id="mv-sens" min="30" max="200" value="100" style="width:120px" />
        <label style="font-size:13px" class="muted"><input type="checkbox" id="mv-inv" /> Invert Y</label>
        <button class="secondary" id="mv-leave" style="padding:6px 12px;font-size:13px">Leave</button>
      </div>`;
    this.container.appendChild(wrap);
    this.hudScore = wrap.querySelector("#mv-score0") as HTMLElement;
    const s1 = wrap.querySelector("#mv-score1") as HTMLElement;
    this.hudNames = wrap.querySelector("#mv-name0") as HTMLElement;
    const n1 = wrap.querySelector("#mv-name1") as HTMLElement;
    this.hudPhase = wrap.querySelector("#mv-phase") as HTMLElement;
    this.hudSpec = wrap.querySelector("#mv-spec") as HTMLElement;
    this.hudServe = wrap.querySelector("#mv-serve") as HTMLElement;
    this.hudConns = [wrap.querySelector("#mv-name0")!, wrap.querySelector("#mv-name1")!];
    void s1; void n1;
    (wrap.querySelector("#mv-sens") as HTMLInputElement).oninput = (e) => {
      this.sensitivity = Number((e.target as HTMLInputElement).value) / 100;
    };
    (wrap.querySelector("#mv-inv") as HTMLInputElement).onchange = (e) => {
      this.invertY = (e.target as HTMLInputElement).checked;
    };
    (wrap.querySelector("#mv-leave") as HTMLButtonElement).onclick = () => this.leave();
  }

  private resize = (): void => {
    const w = this.container.clientWidth;
    const h = this.container.clientHeight;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  };

  // ---------- input ----------

  private onMouseMove = (e: MouseEvent): void => {
    if (this.spectate || this.mySide === null) return;
    const rect = this.container.getBoundingClientRect();
    const nx = ((e.clientX - rect.left) / rect.width) * 2 - 1;
    const ny = ((e.clientY - rect.top) / rect.height) * 2 - 1;
    const dir = this.invertY ? 1 : -1;
    this.targetZ = nx * 1.15 * this.sensitivity;
    this.targetY = THREE.MathUtils.clamp(1.15 - ny * dir * 0.85 * this.sensitivity, 0.25, 2.3);
  };

  private onKey = (e: KeyboardEvent, down: boolean): void => {
    if (down) this.keys.add(e.code); else this.keys.delete(e.code);
    if (down && (e.code === "Space" || e.code === "Enter")) {
      e.preventDefault();
      this.tryServe();
    }
  };

  private onClick = (): void => this.tryServe();

  private bindInput(): void {
    this.container.addEventListener("mousemove", this.onMouseMove);
    this.container.addEventListener("click", this.onClick);
    window.addEventListener("keydown", (e) => this.onKey(e, true));
    window.addEventListener("keyup", (e) => this.onKey(e, false));
  }

  private tryServe(): void {
    const s = this.latest;
    if (!s || s.phase !== "serve_ready" || s.yourSide === null) return;
    if (s.serverSide !== s.yourSide) return;
    // swing-based serve velocity
    const dir = s.yourSide === 0 ? 1 : -1;
    const vel = {
      x: dir * (5.2 + Math.min(3, Math.abs(this.localVel.x))),
      y: -3.6 + this.localVel.y * 0.15,
      z: THREE.MathUtils.clamp(this.localVel.z * 0.5, -2, 2),
    };
    net.send({ type: "serve", vel });
  }

  // ---------- net ----------

  private handleNet(msg: Record<string, unknown>): void {
    if (msg.type !== "state") return;
    const snap = msg as unknown as GameSnapshot;
    if (snap.matchId !== this.matchId && !snap.spectator) return;
    this.latest = snap;
    this.history.push({ t: performance.now() / 1000, snap });
    if (this.history.length > 120) this.history.shift();
    if (snap.yourSide !== null || snap.yourSide === null) {
      this.mySide = snap.yourSide;
    }
    // record remote paddle history
    for (const p of snap.paddles) {
      const side = p.side as 0 | 1;
      if (side === this.mySide && !this.spectate) continue;
      const h = this.remotePaddleHist[side];
      if (h) {
        h.push({ t: performance.now() / 1000, p });
        if (h.length > 60) h.shift();
      }
    }
    if (snap.winner !== null && snap.phase === "match_end") {
      this.onMatchEnd?.(snap);
    }
    this.updateHud(snap);
  }

  private updateHud(s: GameSnapshot): void {
    const names = this.hudConns;
    for (let i = 0; i < 2; i++) {
      const p = s.paddles[i];
      if (p) {
        const el = document.getElementById(`mv-name${i}`);
        if (el) {
          el.innerHTML = `${p.username}<br><span class="conn ${p.connected ? "ok" : "bad"}">${p.connected ? "●" : "○"}</span>`;
        }
      }
    }
    void names;
    const sc = document.getElementById("mv-score0") as HTMLElement;
    const sc1 = document.getElementById("mv-score1") as HTMLElement;
    if (sc) sc.textContent = String(s.score[0]);
    if (sc1) sc1.textContent = String(s.score[1]);
    const phaseTxt: Record<string, string> = {
      countdown: "Get ready…",
      serve_ready: s.serverSide === s.yourSide ? "Your serve" : `${s.paddles[s.serverSide]?.username ?? "?"}'s serve`,
      rally: "",
      point_end: "Point!",
      match_end: s.winner !== null ? `${s.paddles[s.winner]?.username ?? "?"} wins!` : "Match over",
    };
    this.hudPhase.textContent = phaseTxt[s.phase] ?? "";
    this.hudSpec.textContent = s.spectators > 0 ? `👁 ${s.spectators}` : "";
    const canServe = s.phase === "serve_ready" && s.yourSide !== null && s.serverSide === s.yourSide;
    this.hudServe.classList.toggle("hidden", !canServe);
  }

  // ---------- loop ----------

  private leave(): void {
    net.send({ type: "room:leave" });
    this.dispose();
    this.onExit?.();
  }

  dispose(): void {
    this.disposed = true;
    cancelAnimationFrame(this.raf);
    window.removeEventListener("resize", this.resize);
    this.unsub?.();
    this.renderer.dispose();
    this.renderer.domElement.remove();
    this.container.querySelectorAll(".hud-top,.hud-phase,.spectator-count,.serve-hint,.hud-bottom").forEach((e) => e.remove());
  }

  private loop = (t: number): void => {
    if (this.disposed) return;
    this.raf = requestAnimationFrame(this.loop);
    const now = t / 1000;
    const dt = Math.min(0.05, now - this.lastT);
    this.lastT = now;

    this.updateLocalPaddle(dt);
    this.sendInput(now);
    this.render(now);
    this.renderer.render(this.scene, this.camera);
  };

  private updateLocalPaddle(dt: number): void {
    if (this.spectate || this.mySide === null) return;
    // depth control via keys: ArrowUp/W = toward table, ArrowDown/S = away
    if (this.keys.has("ArrowUp") || this.keys.has("KeyW")) this.depthOffset += dt * 1.4;
    if (this.keys.has("ArrowDown") || this.keys.has("KeyS")) this.depthOffset -= dt * 1.4;
    this.depthOffset = THREE.MathUtils.clamp(this.depthOffset, -0.7, 0.7);

    // sideSign: -1 for side 0 (negative x), +1 for side 1
    const sideSign = this.mySide === 0 ? -1 : 1;
    // positive depthOffset moves paddle toward the table (smaller |x|)
    const x = sideSign * (1.95 - this.depthOffset);
    const target = new THREE.Vector3(x, this.targetY, this.targetZ);

    // smooth follow
    const k = 1 - Math.exp(-dt * 18);
    this.lastLocalPos.copy(this.localPos);
    this.localPos.lerp(target, k);
    this.localVel.copy(this.localPos).sub(this.lastLocalPos).divideScalar(Math.max(dt, 1e-4));
    if (this.localVel.length() > 20) this.localVel.setLength(20);

    // orientation: face table + slight tilt from velocity
    const yaw = this.mySide === 0 ? Math.PI / 2 : -Math.PI / 2;
    const pitch = THREE.MathUtils.clamp(-this.localVel.y * 0.04, -0.5, 0.5);
    const roll = THREE.MathUtils.clamp(this.localVel.z * 0.03, -0.4, 0.4);
    const q = new THREE.Quaternion().setFromEuler(new THREE.Euler(pitch, yaw, roll, "YXZ"));
    const mesh = this.paddles[this.mySide];
    if (mesh) {
      mesh.group.position.copy(this.localPos);
      mesh.group.quaternion.copy(q);
    }
  }

  private sendInput(now: number): void {
    if (this.spectate || this.mySide === null) return;
    if (now - this.lastSend < 1 / INPUT_HZ) return;
    this.lastSend = now;
    this.seq++;
    const q = this.paddles[this.mySide!]?.group.quaternion;
    const quat: [number, number, number, number] = q
      ? [q.x, q.y, q.z, q.w]
      : [0, 0, 0, 1];
    net.send({
      type: "input",
      seq: this.seq,
      paddle: {
        pos: { x: this.localPos.x, y: this.localPos.y, z: this.localPos.z },
        quat,
        vel: { x: this.localVel.x, y: this.localVel.y, z: this.localVel.z },
        angVel: { x: 0, y: 0, z: 0 },
        faceRadius: PADDLE_FACE_RADIUS,
      },
    });
  }

  private render(now: number): void {
    const s = this.latest;
    if (!s) return;

    // ball interpolation
    if (s.ball) {
      const renderT = now - INTERP_DELAY;
      const hist = this.history.filter((h) => h.snap.ball);
      let bpos = s.ball.pos;
      if (hist.length >= 2) {
        for (let i = hist.length - 1; i > 0; i--) {
          const a = hist[i - 1]!;
          const b = hist[i]!;
          if (a.t <= renderT && b.t >= renderT) {
            const f = (renderT - a.t) / Math.max(1e-4, b.t - a.t);
            bpos = {
              x: a.snap.ball!.pos.x + (b.snap.ball!.pos.x - a.snap.ball!.pos.x) * f,
              y: a.snap.ball!.pos.y + (b.snap.ball!.pos.y - a.snap.ball!.pos.y) * f,
              z: a.snap.ball!.pos.z + (b.snap.ball!.pos.z - a.snap.ball!.pos.z) * f,
            };
            break;
          }
        }
      }
      this.ball.position.set(bpos.x, bpos.y, bpos.z);
      this.ball.visible = true;
    } else {
      // hide ball during countdown / before serve; show at server paddle during serve_ready
      const srvPaddle = s.paddles[s.serverSide];
      if (s.phase === "serve_ready" && srvPaddle) {
        const p = srvPaddle;
        this.ball.position.set(p.pos.x + (s.serverSide === 0 ? 0.12 : -0.12), p.pos.y + 0.05, p.pos.z);
        this.ball.visible = true;
      } else {
        this.ball.visible = false;
      }
    }

    // remote paddles
    for (const p of s.paddles) {
      const side = p.side as 0 | 1;
      const isLocal = side === this.mySide && !this.spectate;
      const mesh = this.paddles[side];
      if (!mesh) continue;
      mesh.group.visible = true;
      this.paddleNames[side] = p.username;
      if (isLocal) continue; // local paddle already positioned
      // interpolate remote paddle
      const hist = this.remotePaddleHist[side] ?? [];
      let pos = p.pos;
      const renderT = now - INTERP_DELAY;
      for (let i = hist.length - 1; i > 0; i--) {
        const a = hist[i - 1]!;
        const b = hist[i]!;
        if (a.t <= renderT && b.t >= renderT) {
          const f = (renderT - a.t) / Math.max(1e-4, b.t - a.t);
          pos = {
            x: a.p.pos.x + (b.p.pos.x - a.p.pos.x) * f,
            y: a.p.pos.y + (b.p.pos.y - a.p.pos.y) * f,
            z: a.p.pos.z + (b.p.pos.z - a.p.pos.z) * f,
          };
          break;
        }
      }
      mesh.group.position.set(pos.x, pos.y, pos.z);
      mesh.group.quaternion.copy(quatToThree(p.quat));
    }
    // hide paddle slot if no player
    for (let i = 0; i < 2; i++) {
      if (!s.paddles[i] && this.paddles[i]) this.paddles[i]!.group.visible = false;
    }

    // camera
    this.updateCamera(s, now);
  }

  private camPos = new THREE.Vector3();
  private camTarget = new THREE.Vector3();

  private updateCamera(s: GameSnapshot, now: number): void {
    void now;
    if (this.mySide !== null && !this.spectate) {
      const sideSign = this.mySide === 0 ? -1 : 1;
      // behind the player, slightly above table, looking across
      const desired = new THREE.Vector3(sideSign * 3.6, 1.75, 0);
      const ball = s.ball?.pos ?? { x: 0, y: 1, z: 0 };
      const look = new THREE.Vector3(
        THREE.MathUtils.clamp(ball.x * 0.4, -0.8, 0.8),
        0.95,
        THREE.MathUtils.clamp(ball.z * 0.25, -0.4, 0.4),
      );
      const k = 0.08;
      this.camPos.lerp(desired, k);
      this.camTarget.lerp(look, 0.12);
      if (this.camPos.lengthSq() === 0) this.camPos.copy(desired);
      this.camera.position.copy(this.camPos);
      this.camera.lookAt(this.camTarget);
    } else {
      // spectator / overview cinematic
      const t = performance.now() / 1000;
      const r = 4.6;
      this.camera.position.set(Math.sin(t * 0.15) * r, 2.2 + Math.sin(t * 0.3) * 0.4, Math.cos(t * 0.15) * r);
      this.camera.lookAt(0, 0.8, 0);
    }
  }
}
