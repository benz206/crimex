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

const LRU_MAX = 50;
const snapshotCache = new Map<string, unknown>();   // key: bucket/objectKey, bounded LRU

function lruGet(key: string): unknown | undefined {
  if (!snapshotCache.has(key)) return undefined;
  const val = snapshotCache.get(key);
  snapshotCache.delete(key);
  snapshotCache.set(key, val);
  return val;
}

function lruSet(key: string, val: unknown): void {
  if (snapshotCache.size >= LRU_MAX) {
    snapshotCache.delete(snapshotCache.keys().next().value!);
  }
  snapshotCache.set(key, val);
}

export async function fetchJsonFromR2(bucket: string, objectKey: string): Promise<unknown> {
  const cacheKey = `${bucket}/${objectKey}`;
  const cached = lruGet(cacheKey);
  if (cached !== undefined) return cached;
  const client = getClient();
  const resp = await client.send(new GetObjectCommand({ Bucket: bucket, Key: objectKey }));
  if (!resp.Body) throw new Error(`R2 object ${cacheKey} returned empty body`);
  const text = await resp.Body.transformToString("utf-8");
  const parsed = JSON.parse(text);
  lruSet(cacheKey, parsed);
  return parsed;
}

export function clearR2Cache() { snapshotCache.clear(); }
