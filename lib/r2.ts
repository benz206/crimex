import { S3Client, GetObjectCommand } from "@aws-sdk/client-s3";

const accountId = process.env.R2_ACCOUNT_ID;
const accessKeyId = process.env.R2_ACCESS_KEY_ID;
const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;

let cachedClient: S3Client | null = null;
function getClient(): S3Client {
  if (!accountId || !accessKeyId || !secretAccessKey) {
    throw new Error("R2 credentials missing — set R2_ACCOUNT_ID, R2_ACCESS_KEY_ID, R2_SECRET_ACCESS_KEY");
  }
  if (cachedClient) return cachedClient;
  cachedClient = new S3Client({
    region: "auto",
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId, secretAccessKey },
  });
  return cachedClient;
}

const snapshotCache = new Map<string, unknown>();   // key: bucket/objectKey

export async function fetchJsonFromR2(bucket: string, objectKey: string): Promise<unknown> {
  const cacheKey = `${bucket}/${objectKey}`;
  const cached = snapshotCache.get(cacheKey);
  if (cached) return cached;
  const client = getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!resp.Body) throw new Error(`R2 object ${cacheKey} returned empty body`);
  const text = await resp.Body.transformToString("utf-8");
  const parsed = JSON.parse(text);
  snapshotCache.set(cacheKey, parsed);
  return parsed;
}

export function clearR2Cache() { snapshotCache.clear(); }
