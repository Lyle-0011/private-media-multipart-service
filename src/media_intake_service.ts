import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { randomUUID } from "node:crypto";
import { z } from "zod";
import { infrai, InfraiError } from "./infrai_storage";
import { AssetMissing, MediaWorkflow, WorkflowConflict } from "./media_workflow";
import { mediaBucket } from "./setup_bucket";

const workflow = new MediaWorkflow();
const port = Number(process.env.PORT ?? 3000);

const startSchema = z.object({
  creator_id: z.string().min(1),
  filename: z.string().min(1).max(180),
  content_type: z.string().regex(/^(video|audio)\//),
});
const partSchema = z.object({ part_number: z.number().int().min(1).max(10_000) });
const completeSchema = z.object({
  parts: z.array(z.object({ part_number: z.number().int().min(1), etag: z.string().min(1) })).min(1),
});
const readySchema = z.object({ processing_receipt: z.string().min(1) });
const deliverySchema = z.object({ creator_id: z.string().min(1) });

async function jsonBody(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk));
  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

function send(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json" });
  response.end(JSON.stringify(body));
}

function safeFilename(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]/g, "_");
}

async function route(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? "/", "http://localhost");
  const segments = url.pathname.split("/").filter(Boolean);

  if (request.method === "POST" && url.pathname === "/ingestions") {
    const input = startSchema.parse(await jsonBody(request));
    const assetId = randomUUID();
    const objectKey = `creators/${input.creator_id}/${assetId}/${safeFilename(input.filename)}`;
    const created = await infrai.storage.multipart.create(
      mediaBucket,
      objectKey,
      input.content_type,
      `ingestion:${assetId}`,
    );
    workflow.recordUpload({
      assetId,
      creatorId: input.creator_id,
      objectKey,
      uploadId: created.upload_id,
      state: "uploading",
    });
    send(response, 201, { asset_id: assetId, state: "uploading" });
    return;
  }

  const assetId = segments[1];
  if (request.method === "POST" && segments[0] === "ingestions" && segments[2] === "parts") {
    const input = partSchema.parse(await jsonBody(request));
    const asset = workflow.requireAsset(assetId);
    const signed = await infrai.storage.multipart.presign_part(
      asset.uploadId,
      input.part_number,
      `part:${asset.assetId}:${input.part_number}`,
    );
    send(response, 200, { method: "PUT", upload_url: signed.url, part_number: input.part_number });
    return;
  }

  if (request.method === "POST" && segments[0] === "ingestions" && segments[2] === "complete") {
    const input = completeSchema.parse(await jsonBody(request));
    const asset = workflow.requireAsset(assetId);
    const parts = input.parts.map((part) => ({ part_number: part.part_number, etag: part.etag }));
    await infrai.storage.multipart.complete(asset.uploadId, parts, `complete:${asset.assetId}`);
    send(response, 202, workflow.markProcessing(assetId));
    return;
  }

  if (request.method === "POST" && segments[0] === "jobs" && segments[2] === "ready") {
    readySchema.parse(await jsonBody(request));
    send(response, 200, workflow.markReady(assetId));
    return;
  }

  if (request.method === "POST" && segments[0] === "deliveries" && segments[2] === "sign") {
    const input = deliverySchema.parse(await jsonBody(request));
    const asset = workflow.requireDelivery(assetId, input.creator_id);
    const signed = await infrai.storage.object.presign(
      mediaBucket,
      asset.objectKey,
      `delivery:${asset.assetId}:${input.creator_id}`,
    );
    send(response, 200, { method: "GET", download_url: signed.url, expires_seconds: 900 });
    return;
  }

  send(response, 404, { error: "route_not_found" });
}

createServer(async (request, response) => {
  try {
    await route(request, response);
  } catch (error) {
    if (error instanceof z.ZodError) return send(response, 400, { error: "invalid_request", issues: error.issues });
    if (error instanceof AssetMissing) return send(response, 404, { error: "asset_not_found" });
    if (error instanceof WorkflowConflict) return send(response, 409, { error: "invalid_asset_state" });
    if (error instanceof InfraiError) {
      const status = error.status >= 400 && error.status < 500 ? error.status : 502;
      return send(response, status, { error: error.detail.code ?? "storage_request_rejected" });
    }
    console.error(error);
    return send(response, 500, { error: "internal_error" });
  }
}).listen(port, () => console.log(`media intake listening on http://localhost:${port}`));
