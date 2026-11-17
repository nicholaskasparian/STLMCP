# STLMCP

**An OpenSCAD rendering API for AI-assisted CAD workflows.**

Send OpenSCAD source code to an HTTP endpoint and get up to **16 PNG views** of the resulting 3D model—top, bottom, and multiple oblique angles. The output helps agents and developers inspect geometry without manually opening a CAD application.

## How it works

1. `POST /api/render` accepts `{ "code": "..." }`.
2. An Express service writes the source to a temporary file and runs OpenSCAD headlessly across 16 camera angles.
3. The endpoint returns labeled, base64-encoded **800 × 600 PNG** images.

**Engineering details:** TypeScript, Express, Zod request validation, parallel subprocess rendering, a two-request concurrency limit, per-render timeouts, automatic temporary-file cleanup, Docker, and Xvfb.

## Run

**Docker** (recommended):

```bash
docker build -t stlmcp .
docker run --rm -p 3000:3000 stlmcp
```

**Local:** requires Node.js 20+, OpenSCAD on `PATH`, and a working display (or Xvfb on headless Linux).

```bash
npm install
npm run build
npm start
```

Test the API:

```bash
curl -X POST http://localhost:3000/api/render \
  -H 'Content-Type: application/json' \
  -d '{"code":"cube([20,20,20]);"}'
```

`GET /health` returns the service status and configured number of camera angles.

## Scope and security

This is a **JSON/HTTP API**, not an MCP-protocol server; an agent can call it directly or via an adapter. The current endpoint has **no authentication** and invokes a CAD renderer on submitted code. Use it in a trusted environment; add authentication, robust resource limits, and execution isolation before exposing it publicly.
