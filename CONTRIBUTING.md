# Contributing

1. Fork the repo, create a branch.
2. `npm install`, copy `.env.example` → `.env`, set `DATABASE_URL`.
3. `./dev.sh` for development; `npm test` must pass.
4. Keep changes focused; match existing TypeScript style (strict mode).
5. Server stays authoritative — never move scoring/physics trust to the client.
6. Open a PR with a clear description; CI must be green.

License: BSD 3-Clause (see LICENSE). By contributing you agree your code is licensed accordingly.
