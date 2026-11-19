# Security

## Model

- **Server-authoritative**: clients send only paddle input and serve intent. Scores, ball state, collisions, ratings are computed server-side and never accepted from clients.
- **Input validation**: zod schemas on REST + WS; paddle bounds/speed/quaternion checks; serve velocity limits; rate limiting via seq/displacement checks.
- **Auth**: Argon2id password hashing; sessions are random 256-bit tokens stored as SHA-256 hashes; HttpOnly + SameSite=Lax cookies; expiry + revocation; origin allowlist on both CORS and WS upgrade.
- **DB**: parameterized queries only (pg); no dynamic SQL; UUIDs non-guessable.
- **Headers**: request body limit 64 KB; CORS restricted to `ALLOWED_ORIGINS`; errors don't leak internals (500 → generic message).

## Threat model (summary)

| Threat | Mitigation |
|---|---|
| Credential theft | Argon2id, no plaintext storage |
| Session hijack | HttpOnly cookie, token hashed at rest, expiry |
| XSS | React-free escaped rendering (`escapeHtml`), no `innerHTML` with user data unescaped |
| CSRF | SameSite=Lax + origin checks on WS |
| SQLi | parameterized queries exclusively |
| Game cheating | server-side physics; impossible-state rejection; Elo only from server-confirmed results |
| DoS | body limits, connection cleanup, grace-period forfeits |

## Reporting

Open a private security advisory on the GitHub repository. Do not file public issues for vulnerabilities.
