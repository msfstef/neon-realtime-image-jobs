import {
  DeleteObjectsCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import { env } from "./env.js";

// AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_ENDPOINT_URL_S3, and AWS_REGION
// are injected for the branch, so the SDK needs no explicit configuration.
const s3 = new S3Client({ forcePathStyle: true });

export function jobPrefix(userId: string, jobId: string) {
  return `users/${userId}/jobs/${jobId}/`;
}

export async function putObject(key: string, body: Uint8Array, contentType: string) {
  await s3.send(
    new PutObjectCommand({ Bucket: env.bucket, Key: key, Body: body, ContentType: contentType }),
  );
}

export function signedGetUrl(key: string, expiresIn = 15 * 60) {
  return getSignedUrl(s3, new GetObjectCommand({ Bucket: env.bucket, Key: key }), { expiresIn });
}

export async function deletePrefix(prefix: string) {
  const listed = await s3.send(new ListObjectsV2Command({ Bucket: env.bucket, Prefix: prefix }));
  const objects = (listed.Contents ?? []).flatMap((object) => (object.Key ? [{ Key: object.Key }] : []));
  if (objects.length === 0) return;
  await s3.send(new DeleteObjectsCommand({ Bucket: env.bucket, Delete: { Objects: objects } }));
}
