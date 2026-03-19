# STLMCP

A **no-auth HTTP API** that accepts OpenSCAD source code and returns PNG renders from **16 camera angles** — giving AI assistants and other clients a full 360° view of any 3D model.

## Features

- **No authentication required** — drop-in, zero-config for local or cloud use
- **16 angles per render**: top, 8 high-angle (55° tilt), 6 low-angle (75° tilt), bottom
- **800 × 600 px PNG** output, base64-encoded in the tool response
- **Free-hostable** on [Render](https://render.com) via Docker

---

## API Endpoint

### `POST /api/render`

**Request body**

{
  "code": "sphere(r=20, $fn=64);"
}

**Response body**

```json
{
  "images": [
    {
      "label": "top",
      "mimeType": "image/png",
      "data": "<base64>"
    }
  ]
}
```

`images` contains up to 16 angle renders; at least one successful render is required.

#### cURL example

```bash
curl -X POST http://localhost:3000/api/render \
  -H "content-type: application/json" \
  -d '{"code":"sphere(r=20, $fn=64);"}'
```

---

## Running locally

### Prerequisites

- Node.js ≥ 20
- [OpenSCAD](https://openscad.org/downloads.html) installed and on `PATH`
- (Linux/macOS) `Xvfb` for headless display (install via `apt install xvfb` or `brew install --cask xquartz`)

```bash
# Install dependencies
npm install

# Build TypeScript
npm run build

# Start the server (set DISPLAY if running headlessly)
DISPLAY=:99 npm start
# or, with auto-reload during development:
npm run dev
```

The server listens on `http://localhost:3000` by default.  
Set `PORT` to override.

---

## Deploying to Render (free tier)

1. Push this repository to GitHub.
2. Create a new **Web Service** on [render.com](https://render.com).
3. Connect your GitHub repo; Render will detect `render.yaml` automatically.
4. Click **Deploy** — Render builds the Docker image and starts the service.

The `/health` endpoint is used as Render's health-check probe.

---

## Docker

```bash
# Build
docker build -t stlmcp .

# Run
docker run -p 3000:3000 stlmcp
```

---

## Architecture

```
Client (AI / API client)
        │  POST /api/render  (JSON)
        ▼
  Node.js / Express
        │
        └── writes SCAD → tmp dir
            runs openscad (×16 angles, in parallel)
                  │  needs Xvfb (virtual display)
                  ▼
            reads PNG files → base64
                  ▼
            returns image array to client
```

## Camera angles

| Group     | Count | rx (tilt) | rz (azimuth)        |
|-----------|-------|-----------|---------------------|
| Top       | 1     | 0°        | 0°                  |
| High ring | 8     | 55°       | 0° … 315° (×45°)    |
| Low ring  | 6     | 75°       | 0° … 300° (×60°)    |
| Bottom    | 1     | 180°      | 0°                  |
| **Total** | **16**|           |                     |
