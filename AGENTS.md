# AGENTS

This service exposes a single HTTP endpoint for rendering OpenSCAD code:

- **POST `/api/render`**
- JSON request body: `{ "code": "<OpenSCAD source>" }`
- JSON response body: `{ "images": [{ "label", "mimeType", "data" }] }`

## How agents should use it

1. Generate valid OpenSCAD source code.
2. Send it to `/api/render` as JSON.
3. Decode each image `data` field from base64 (PNG).
4. Use `label` to interpret viewpoint (`top`, `high_*`, `low_*`, `bottom`).
5. Reason across multiple views before making geometric conclusions.

## Error handling

- `400` → invalid request body (missing/empty `code`).
- `429` → renderer is busy; retry with backoff.
- `500` → render failure (invalid geometry, OpenSCAD errors, or environment issues).

## Notes

- Up to 16 angles are attempted per render; partial angle failures are allowed.
- At least one successful angle is required for a successful API response.
- Payloads are base64 PNGs; handle large responses accordingly.
