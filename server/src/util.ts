import { randomBytes, randomUUID, createHash } from "node:crypto";

export function uuid(): string {
  return randomUUID();
}

export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function randomToken(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

const ROOM_CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";

export function roomCode(): string {
  let out = "";
  const buf = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    out += ROOM_CODE_ALPHABET[(buf[i] ?? 0) % ROOM_CODE_ALPHABET.length];
  }
  return out;
}

export function isUsername(s: string): boolean {
  return /^[a-zA-Z0-9_]{3,20}$/.test(s);
}
