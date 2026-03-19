import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import express, { type Request, type Response } from "express";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { mkdtemp, writeFile, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { z } from "zod";

const execFileAsync = promisify(execFile);

const PORT = parseInt(process.env.PORT ?? "3000", 10);

/**
 * 16 camera angles providing comprehensive 360° coverage of any 3D model.
 *
 * OpenSCAD rotate-camera format: --camera=tx,ty,tz,rx,ry,rz,dist
 *   tx,ty,tz = translation of camera center (0,0,0 = model origin)
 *   rx       = tilt from top: 0° = top view, 90° = side view, 180° = bottom view
 *   ry       = roll (unused, kept 0)
 *   rz       = azimuth rotation around Z axis
 *   dist     = distance (overridden by --viewall to fit the model)
 */
const CAMERA_ANGLES = [
  // 1 – top-down
  { rx: 0, rz: 0, label: "top" },

  // 8 – high-angle ring (rx=55°, every 45°)
  { rx: 55, rz: 0, label: "high_0" },
  { rx: 55, rz: 45, label: "high_45" },
  { rx: 55, rz: 90, label: "high_90" },
  { rx: 55, rz: 135, label: "high_135" },
  { rx: 55, rz: 180, label: "high_180" },
  { rx: 55, rz: 225, label: "high_225" },
  { rx: 55, rz: 270, label: "high_270" },
  { rx: 55, rz: 315, label: "high_315" },

  // 6 – low-angle ring (rx=75°, every 60°)
  { rx: 75, rz: 0, label: "low_0" },
  { rx: 75, rz: 60, label: "low_60" },
  { rx: 75, rz: 120, label: "low_120" },
  { rx: 75, rz: 180, label: "low_180" },
  { rx: 75, rz: 240, label: "low_240" },
  { rx: 75, rz: 300, label: "low_300" },

  // 1 – bottom-up
  { rx: 180, rz: 0, label: "bottom" },
] as const;

/** Simple semaphore to avoid saturating CPU on the free tier. */
let activeRenders = 0;
const MAX_CONCURRENT = 2;

type RenderedImage = { label: string; data: string; mimeType: "image/png" };

/**
 * Renders OpenSCAD source code from every angle in CAMERA_ANGLES and returns
 * base64-encoded PNG images. At least one angle must succeed; partial results
 * are returned when some angles fail.
 */
async function renderOpenSCAD(scadCode: string): Promise<RenderedImage[]> {
  if (activeRenders >= MAX_CONCURRENT) {
    throw new Error("Server is busy — please retry in a moment.");
  }

  activeRenders++;
  const tmpDir = await mkdtemp(join(tmpdir(), "openscad-"));
  const scadFile = join(tmpDir, "model.scad");

  try {
    // Sanitise: reject null bytes which could corrupt the temp file path
    if (scadCode.includes("\0")) {
      throw new Error("Invalid input: null bytes are not allowed in OpenSCAD code.");
    }

    await writeFile(scadFile, scadCode, "utf8");

    const settled = await Promise.allSettled(
      CAMERA_ANGLES.map(async ({ rx, rz, label }) => {
        const pngFile = join(tmpDir, `${label}.png`);

        await execFileAsync(
          "openscad",
          [
            "--render",
            "--imgsize=800,600",
            `--camera=0,0,0,${rx},0,${rz},500`,
            "--viewall",
            "-o",
            pngFile,
            scadFile,
          ],
          {
            timeout: 90_000, // 90 s per angle
            env: { ...process.env, DISPLAY: process.env.DISPLAY ?? ":99" },
          },
        );

        const buf = await readFile(pngFile);
        return { label, data: buf.toString("base64"), mimeType: "image/png" as const };
      }),
    );

    const images: RenderedImage[] = [];
    const errors: string[] = [];

    for (const r of settled) {
      if (r.status === "fulfilled") {
        images.push(r.value);
      } else {
        errors.push(r.reason instanceof Error ? r.reason.message : String(r.reason));
      }
    }

    if (images.length === 0) {
      throw new Error(
        `All ${CAMERA_ANGLES.length} renders failed.\n` + errors.slice(0, 5).join("\n"),
      );
    }

    return images;
  } finally {
    activeRenders--;
    await rm(tmpDir, { recursive: true, force: true }).catch(() => {});
  }
}

/** Build a fresh McpServer with the render_openscad tool registered. */
function buildMcpServer(): McpServer {
  const server = new McpServer({
    name: "openscad-renderer",
    version: "1.0.0",
  });

  server.registerTool(
    "render_openscad",
    {
      title: "Render OpenSCAD",
      description: [
        "Render OpenSCAD source code and return PNG images from 16 camera angles.",
        "Angles: 1 top-down view, 8 high-angle views (55° tilt, every 45°),",
        "6 low-angle views (75° tilt, every 60°), and 1 bottom-up view.",
        "Each image is 800×600 px, base64-encoded PNG.",
      ].join(" "),
      inputSchema: {
        code: z.string().min(1).describe("OpenSCAD (.scad) source code to render"),
      },
    },
    async ({ code }) => {
      try {
        const images = await renderOpenSCAD(code);
        return {
          content: images.map(({ data, mimeType }) => ({
            type: "image" as const,
            data,
            mimeType,
          })),
        };
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        return {
          isError: true,
          content: [{ type: "text" as const, text: `Render error: ${message}` }],
        };
      }
    },
  );

  return server;
}

// ---------------------------------------------------------------------------
// Express app
// ---------------------------------------------------------------------------

const app = express();
app.use(express.json({ limit: "5mb" }));

/** Health / readiness probe for Render. */
app.get("/health", (_req: Request, res: Response) => {
  res.json({ status: "ok", service: "openscad-renderer", angles: CAMERA_ANGLES.length });
});

/**
 * MCP endpoint — stateless mode.
 *
 * Each POST request is fully self-contained: a new McpServer + transport pair
 * is created, the request is handled, and both are closed immediately. This
 * avoids session state so the server can be scaled horizontally or restarted
 * freely (suitable for Render's free tier).
 */
app.post("/mcp", async (req: Request, res: Response) => {
  const transport = new StreamableHTTPServerTransport({
    sessionIdGenerator: undefined, // stateless — no session IDs
  });
  const server = buildMcpServer();

  try {
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  } catch (err) {
    if (!res.headersSent) {
      res.status(500).json({
        jsonrpc: "2.0",
        error: { code: -32603, message: "Internal server error" },
        id: null,
      });
    }
  } finally {
    res.on("finish", () => {
      server.close().catch(() => {});
    });
  }
});

app.listen(PORT, () => {
  console.log(`OpenSCAD MCP server listening on port ${PORT}`);
  console.log(`  Health : http://localhost:${PORT}/health`);
  console.log(`  MCP    : http://localhost:${PORT}/mcp  (POST)`);
});
