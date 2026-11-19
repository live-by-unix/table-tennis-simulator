import * as THREE from "three";
import { TABLE } from "./constants";

export interface World {
  scene: THREE.Scene;
  tableTop: THREE.Mesh;
}

function makeTable(): THREE.Group {
  const g = new THREE.Group();
  const W = TABLE.WIDTH, L = TABLE.LENGTH, H = TABLE.HEIGHT, T = TABLE.THICKNESS;

  // top: two halves (blue / red) + white lines
  const matBlue = new THREE.MeshStandardMaterial({ color: 0x1d4ed8, roughness: 0.55, metalness: 0.05 });
  const matRed = new THREE.MeshStandardMaterial({ color: 0xb91c1c, roughness: 0.55, metalness: 0.05 });
  const matWhite = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.6 });
  const matDark = new THREE.MeshStandardMaterial({ color: 0x27272a, roughness: 0.8 });

  const halfL = L / 2 - 0.005;
  const topL = new THREE.Mesh(new THREE.BoxGeometry(halfL, T, W), matBlue);
  topL.position.set(-L / 4 - 0.0025, H - T / 2, 0);
  const topR = new THREE.Mesh(new THREE.BoxGeometry(halfL, T, W), matRed);
  topR.position.set(L / 4 + 0.0025, H - T / 2, 0);
  g.add(topL, topR);

  // center line (white, 3mm wide along x at z=0)
  const center = new THREE.Mesh(new THREE.BoxGeometry(L - 0.02, 0.002, 0.003), matWhite);
  center.position.set(0, H + 0.001, 0);
  g.add(center);

  // boundary white lines: sideline (z=±W/2) and endline (x=±L/2)
  const lineGeoZ = new THREE.BoxGeometry(L - 0.04, 0.002, 0.02);
  const lineZ1 = new THREE.Mesh(lineGeoZ, matWhite);
  lineZ1.position.set(0, H + 0.001, W / 2 - 0.01);
  const lineZ2 = lineZ1.clone();
  lineZ2.position.z = -W / 2 + 0.01;
  const lineGeoX = new THREE.BoxGeometry(0.02, 0.002, W - 0.04);
  const lineX1 = new THREE.Mesh(lineGeoX, matWhite);
  lineX1.position.set(L / 2 - 0.01, H + 0.001, 0);
  const lineX2 = lineX1.clone();
  lineX2.position.x = -L / 2 + 0.01;
  g.add(lineZ1, lineZ2, lineX1, lineX2);

  // net
  const netH = TABLE.NET_HEIGHT;
  const net = new THREE.Mesh(
    new THREE.BoxGeometry(TABLE.NET_THICKNESS, netH, W + 0.1),
    new THREE.MeshStandardMaterial({ color: 0x111827, transparent: true, opacity: 0.55, side: THREE.DoubleSide }),
  );
  net.position.set(0, H + netH / 2, 0);
  g.add(net);
  // net tape (white top)
  const tape = new THREE.Mesh(new THREE.BoxGeometry(TABLE.NET_THICKNESS + 0.01, 0.015, W + 0.1), matWhite);
  tape.position.set(0, H + netH + 0.005, 0);
  g.add(tape);
  // posts
  const postGeo = new THREE.CylinderGeometry(0.008, 0.008, netH + 0.1, 8);
  for (const z of [-W / 2 - 0.05, W / 2 + 0.05]) {
    const post = new THREE.Mesh(postGeo, matDark);
    post.position.set(0, H + (netH + 0.1) / 2, z);
    g.add(post);
  }

  // legs + apron
  const legGeo = new THREE.BoxGeometry(0.06, H - T, 0.06);
  for (const x of [-L / 2 + 0.15, L / 2 - 0.15]) {
    for (const z of [-W / 2 + 0.15, W / 2 - 0.15]) {
      const leg = new THREE.Mesh(legGeo, matDark);
      leg.position.set(x, (H - T) / 2, z);
      g.add(leg);
    }
  }
  const apron = new THREE.Mesh(new THREE.BoxGeometry(L - 0.2, 0.08, W - 0.2), matDark);
  apron.position.set(0, H - T - 0.04, 0);
  g.add(apron);

  return g;
}

export function buildWorld(): World {
  const scene = new THREE.Scene();
  scene.background = new THREE.Color(0x0b0f14);
  scene.fog = new THREE.Fog(0x0b0f14, 12, 30);

  // lights
  const ambient = new THREE.AmbientLight(0xffffff, 0.55);
  scene.add(ambient);
  const key = new THREE.DirectionalLight(0xfff4e0, 1.4);
  key.position.set(3, 6, 2);
  key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048);
  key.shadow.camera.left = -4;
  key.shadow.camera.right = 4;
  key.shadow.camera.top = 4;
  key.shadow.camera.bottom = -4;
  key.shadow.camera.far = 20;
  scene.add(key);
  const fill = new THREE.DirectionalLight(0xbfd4ff, 0.5);
  fill.position.set(-3, 4, -3);
  scene.add(fill);
  const spot = new THREE.SpotLight(0xffffff, 60, 20, Math.PI / 5, 0.4);
  spot.position.set(0, 5.5, 0);
  spot.target.position.set(0, 0, 0);
  spot.castShadow = false; // key light already casts shadows; avoids a second shadow pass
  scene.add(spot, spot.target);

  // floor
  const floor = new THREE.Mesh(
    new THREE.PlaneGeometry(30, 30),
    new THREE.MeshStandardMaterial({ color: 0x14181f, roughness: 0.95 }),
  );
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  scene.add(floor);

  // walls hint
  const wallMat = new THREE.MeshStandardMaterial({ color: 0x1a2029, roughness: 1 });
  const backWall = new THREE.Mesh(new THREE.PlaneGeometry(30, 8), wallMat);
  backWall.position.set(0, 4, -8);
  scene.add(backWall);
  const frontWall = backWall.clone();
  frontWall.position.z = 8;
  frontWall.rotation.y = Math.PI;
  scene.add(frontWall);

  // table
  const table = makeTable();
  table.traverse((o) => {
    if (o instanceof THREE.Mesh) {
      o.castShadow = true;
      o.receiveShadow = true;
    }
  });
  scene.add(table);

  return { scene, tableTop: table.children[0] as THREE.Mesh };
}
