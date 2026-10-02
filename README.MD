# ChatLab - Intentionally Vulnerable Chat Application (LAB)

**WARNING — FOR EDUCATIONAL USE ONLY**
- This project intentionally includes severe security vulnerabilities for teaching/demonstration purposes.
- **Do NOT** run with `LAB_MODE=true` on any public or production network.
- Run only in an isolated VM or Docker host with no internet access, snapshot before use, and destroy after.

## How to run (safe local steps)
1. Clone repo.
2. Inspect files and confirm `LAB_MODE=true` is set only in `.env` inside the backend folder (this demo requires it).
3. Start with Docker (recommended, local-only):
   - `docker-compose up --build`
   - Backend on http://localhost:4000 (docker mapped to 127.0.0.1)
   - Frontend on http://localhost:3000

## What is intentionally vulnerable
- JWT auth bypass (lab-only 'LAB-BYPASS-TOKEN' accepted)
- File upload stored under webroot (`/uploads`) and served statically
- SSRF-like `/api/fetchmeta` fetch endpoint (no allowlist)
- CSRF vulnerable cookie-based room creation endpoint (no CSRF tokens, SameSite disabled)
- NoSQL injection-like search (`/api/users/search`) that parses raw JSON input in lab mode
- Advanced XSS: frontend renders messages using `dangerouslySetInnerHTML` when `labMode=true`
- WebSocket hijacking: handshake accepts unauthenticated socket in lab mode

## What you must NOT do
- Do not put `LAB_MODE=true` on any machine with real data
- Do not ever expose this host to public internet
- Do not reuse this code in production

## Mitigation checklist (for assignment/report)
For each vulnerable area, implement:
- Strict JWT verification (no special bypass tokens), validate alg, exp, aud, iss; use httpOnly cookies for sessions
- Store uploads outside webroot, validate mime types and file contents, remove exec permissions
- SSRF: implement allowlist, block private IP ranges, re-resolve DNS and check against blocklist
- CSRF: add CSRF tokens, set cookies with SameSite=Strict, validate Origin/Referer
- DB: use parameterized queries / ORM safely; never execute user-provided JSON as query
- XSS: never use dangerouslySetInnerHTML; sanitize on server and client with DOMPurify; set CSP
- WebSocket: validate token at handshake, verify Origin, bind socket to server-side session

## Deliverables
- This repo, logs/screenshots, a written report containing threat models and mitigation steps.
