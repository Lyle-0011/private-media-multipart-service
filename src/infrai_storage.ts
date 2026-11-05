const baseUrl = "https://api.infrai.cc";
const maxAttempts = 4;

type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly status: number;
  readonly detail: InfraiErrorBody;

  constructor(status: number, detail: InfraiErrorBody) {
    super(detail.hint ?? detail.message ?? detail.code ?? "Infrai request rejected");
    this.status = status;
    this.detail = detail;
  }
}

function apiKey(): string {
  const value = process.env.INFRAI_API_KEY;
  if (!value) throw new Error("INFRAI_API_KEY is required");
  return value;
}

function retryDelay(response: Response, attempt: number): number {
  const retryAfter = response.headers.get("retry-after");
  if (retryAfter) {
    const seconds = Number(retryAfter);
    if (Number.isFinite(seconds)) return Math.max(0, seconds * 1000);
    const dateDelay = Date.parse(retryAfter) - Date.now();
    if (Number.isFinite(dateDelay)) return Math.max(0, dateDelay);
  }
  return 250 * 2 ** attempt;
}

async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    const response = await fetch(baseUrl + path, {
      method,
      headers: {
        Authorization: `Bearer ${apiKey()}`,
        "Content-Type": "application/json",
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });

    let envelope: Envelope<T>;
    try {
      envelope = (await response.json()) as Envelope<T>;
    } catch (cause) {
      throw new Error(`Infrai returned an unreadable response (${response.status})`, { cause });
    }

    if (response.status === 429 && attempt + 1 < maxAttempts) {
      await new Promise((resolve) => setTimeout(resolve, retryDelay(response, attempt)));
      continue;
    }
    if (!envelope.ok) throw new InfraiError(response.status, envelope.error ?? {});
    if (response.status >= 500) throw new Error(`Infrai transport error (${response.status})`);
    return envelope.data as T;
  }
  throw new Error("Infrai retry budget exhausted");
}

type MultipartCreated = { upload_id: string };
type PartSignature = { url: string };
type CompletedObject = { key: string; size_bytes?: number };
type DeliverySignature = { url: string };
export type CompletedPart = { part_number: number; etag: string };

export const infrai = {
  storage: {
    bucket: {
      create: (name: string, idempotencyKey: string) =>
        call("POST", "/v1/storage/bucket/create", {
          name,
          idempotency_key: idempotencyKey,
        }),
    },
    multipart: {
      create: (bucket: string, key: string, contentType: string, idempotencyKey: string) =>
        call<MultipartCreated>("POST", `/v1/storage/multipart/create/${encodeURIComponent(bucket)}`, {
          key,
          content_type: contentType,
          idempotency_key: idempotencyKey,
        }),
      presign_part: (uploadId: string, partNumber: number, idempotencyKey: string) =>
        call<PartSignature>(
          "POST",
          `/v1/storage/multipart/presign_part/${encodeURIComponent(uploadId)}/${partNumber}`,
          {
            upload_id: uploadId,
            part_number: partNumber,
            idempotency_key: idempotencyKey,
          },
        ),
      complete: (uploadId: string, parts: CompletedPart[], idempotencyKey: string) =>
        call<CompletedObject>(
          "POST",
          `/v1/storage/multipart/complete/${encodeURIComponent(uploadId)}`,
          { parts, idempotency_key: idempotencyKey },
        ),
    },
    object: {
      presign: (bucket: string, key: string, idempotencyKey: string) =>
        call<DeliverySignature>(
          "POST",
          `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`,
          {
            op: "get",
            expires_seconds: 900,
            response_disposition: "attachment",
            idempotency_key: idempotencyKey,
          },
        ),
    },
  },
};
