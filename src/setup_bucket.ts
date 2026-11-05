import { infrai } from "./infrai_storage";

export const mediaBucket = process.env.MEDIA_BUCKET ?? "private-creator-media";

await infrai.storage.bucket.create(mediaBucket, `bucket:${mediaBucket}`);
console.log(JSON.stringify({ bucket: mediaBucket, ready: true }));
