import {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { Upload } from "@aws-sdk/lib-storage";
import type { Readable } from "node:stream";
import { deriveManifestKey } from "./manifest";

export interface GenerateBackupKeyOptions {
  userId: string;
  databaseName: string;
  timestamp?: Date;
}

/**
 * Sanitizes a database name or user identifier for safe S3 key usage.
 */
function sanitizeKeySegment(segment: string): string {
  return segment.replace(/[^a-zA-Z0-9_-]/g, "_");
}

/**
 * Generates an S3 key for a database backup file.
 * Format: backups/{userId}/{databaseName}_{timestamp}.sql.gz
 */
export function generateBackupS3Key(options: GenerateBackupKeyOptions): string {
  const sanitizedUser = sanitizeKeySegment(options.userId);
  const sanitizedDb = sanitizeKeySegment(options.databaseName);
  const date = options.timestamp || new Date();
  const timestampStr = date.toISOString().replace(/[:.]/g, "-");

  return `backups/${sanitizedUser}/${sanitizedDb}_${timestampStr}.sql.gz`;
}

export { formatBytes } from "./format";

/**
 * Validates and retrieves the S3 configuration from environment variables.
 */
export function getS3Config() {
  const endpoint = process.env.S3_ENDPOINT;
  const region = process.env.S3_REGION || "us-east-1";
  const accessKeyId = process.env.S3_ACCESS_KEY_ID;
  const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
  const bucketName = process.env.S3_BUCKET_NAME;
  const forcePathStyle = process.env.S3_FORCE_PATH_STYLE !== "false";

  if (!endpoint || !accessKeyId || !secretAccessKey || !bucketName) {
    throw new Error(
      "Missing required S3 configuration. Please set S3_ENDPOINT, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY, and S3_BUCKET_NAME in your environment."
    );
  }

  return {
    endpoint,
    region,
    accessKeyId,
    secretAccessKey,
    bucketName,
    forcePathStyle,
  };
}

let s3ClientInstance: S3Client | null = null;

/**
 * Returns a configured AWS S3 Client instance.
 */
export function getS3Client(): S3Client {
  if (s3ClientInstance) {
    return s3ClientInstance;
  }

  const config = getS3Config();

  s3ClientInstance = new S3Client({
    endpoint: config.endpoint,
    region: config.region,
    credentials: {
      accessKeyId: config.accessKeyId,
      secretAccessKey: config.secretAccessKey,
    },
    forcePathStyle: config.forcePathStyle,
  });

  return s3ClientInstance;
}

/**
 * Uploads a readable stream (or Buffer) to S3 using multipart upload.
 */
export async function uploadBackupStream(
  key: string,
  body: Readable | Buffer | Uint8Array
): Promise<void> {
  const client = getS3Client();
  const { bucketName } = getS3Config();

  const parallelUpload = new Upload({
    client,
    params: {
      Bucket: bucketName,
      Key: key,
      Body: body,
      ContentType: "application/gzip",
    },
  });

  await parallelUpload.done();
}

/**
 * Generates a pre-signed S3 download URL valid for 15 minutes.
 */
export async function getBackupDownloadUrl(
  key: string,
  downloadFilename: string
): Promise<string> {
  const client = getS3Client();
  const { bucketName } = getS3Config();

  const command = new GetObjectCommand({
    Bucket: bucketName,
    Key: key,
    ResponseContentDisposition: `attachment; filename="${downloadFilename}"`,
  });

  return await getSignedUrl(client, command, { expiresIn: 900 });
}

/**
 * Deletes an object from S3 storage.
 */
export async function deleteBackupObject(key: string): Promise<void> {
  const client = getS3Client();
  const { bucketName } = getS3Config();

  const command = new DeleteObjectCommand({
    Bucket: bucketName,
    Key: key,
  });

  await client.send(command);
}

/**
 * Uploads a Backup Manifest JSON sibling object alongside a Database Backup dump.
 * The manifest key is derived from the dump key per the convention in `manifest.ts`.
 */
export async function uploadBackupManifest(
  dumpKey: string,
  manifestBytes: Buffer | Uint8Array
): Promise<void> {
  const client = getS3Client();
  const { bucketName } = getS3Config();
  const manifestKey = deriveManifestKey(dumpKey);
  if (!manifestKey) {
    throw new Error(`Cannot derive manifest key from dump key: ${dumpKey}`);
  }

  await client.send(
    new PutObjectCommand({
      Bucket: bucketName,
      Key: manifestKey,
      Body: manifestBytes,
      ContentType: "application/json",
    })
  );
}
