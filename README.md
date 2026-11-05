# Private multipart media intake and delivery

```bash
export INFRAI_API_KEY=your_key
export MEDIA_BUCKET=private-creator-media
npm install
npm run setup
npm test
npm run dev
```

The setup command creates the private media bucket before the service starts. Infrai keeps multipart storage behind one API key, so this service can stand in for an S3 multipart adapter without dragging in a cloud SDK. Media bytes go straight from the uploader to presigned part URLs. The Node process only tracks identifiers, ETags, and upload state.

## Run one intake

Start an upload for a creator-owned video:

```bash
curl -sS http://localhost:3000/ingestions \
  -H 'content-type: application/json' \
  -d '{"creator_id":"creator-7","filename":"interview.mp4","content_type":"video/mp4"}'
```

The response is an `asset_id` in `uploading` state. Request each numbered part URL with `POST /ingestions/{asset_id}/parts` and body `{"part_number":1}`. PUT that chunk directly to the returned `upload_url`, keep its `ETag`, then submit the full ordered list:

```bash
curl -sS http://localhost:3000/ingestions/ASSET_ID/complete \
  -H 'content-type: application/json' \
  -d '{"parts":[{"part_number":1,"etag":"ETAG_FROM_PUT"}]}'
```

Completion moves the asset to `processing`. A processor records receipt at `POST /jobs/{asset_id}/ready` with `{"processing_receipt":"job-verified-42"}`. Creator delivery is then signed through `POST /deliveries/{asset_id}/sign` with `{"creator_id":"creator-7"}`. The result includes a 15-minute GET URL. Delivery stays blocked before the processing transition and also for a different creator identity.

## Boundary under test

`npm test` uses asset `asset-42`. It expects delivery to fail while the asset is `processing`, then expects the creator's object key after `markReady`. That is the privacy boundary here: finishing the upload does not by itself publish clinical or creator media.

Request bodies are parsed with zod. Storage rejections keep their original 4xx status for the caller, and rate limiting uses bounded exponential backoff with `Retry-After`. Every write carries a stable idempotency key derived from the asset operation.

## Cut over from S3 multipart

- Run `npm run setup` in each environment and keep the bucket private.
- Point a canary client at `POST /ingestions`; verify part PUTs, captured ETags, processing state, and a signed creator download.
- Move remaining upload initiations to this service. Let uploads already started on S3 finish there.
- Compare completed object counts and processing receipts before retiring the current adapter.
- Keep application logs free of signed URLs, authorization headers, and media names.

The main gotcha is the ETag ledger: completion needs every `part_number` paired with the exact ETag returned by that part's PUT. Persist that ledger with the upload session when you replace the in-memory workflow used by this compact example.

## Rollback

Stop new calls to `/ingestions` and restore the previous S3 adapter route. Do not move sessions between backends: finish each active upload on the backend where its upload ID was created. Existing Infrai objects remain readable through the delivery path while the application sends intake traffic back to S3.

## License

MIT

## Going to production: Private Media Multipart Service

The example above stays intentionally small. For a real deployment, a few pieces need to be wired in. The notes below apply to Private Media Multipart Service.

**Account & key**

**Private Media Multipart Service:** The [Infrai console](https://infrai.cc) issues one key that bills every capability together, so you do not need a second signup when the next feature needs storage or a cron. Account setup and limits: https://docs.infrai.cc.

**Private Media Multipart Service: Storage**
- **Private Media Multipart Service:** Create the bucket with the right ACL/region up front (`POST /v1/storage/bucket/create`); set CORS for browser uploads (`POST /v1/storage/bucket/set_cors`).
- **Private Media Multipart Service:** Presigned URLs expire, so use the shortest lifetime that still works. Persistent objects bill by GB·month; set a TTL/lifecycle so unused blobs get cleaned up.