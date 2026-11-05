'use strict';

const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const { Readable } = require('stream');
const { pipeline } = require('stream/promises');

const LOCAL_ROOT = process.env.BACKUP_LOCAL_DIR
  || path.join(__dirname, '..', '..', 'storage', 'backups');

function configuredProvider() {
  if (process.env.BACKUP_STORAGE_PROVIDER) {
    return String(process.env.BACKUP_STORAGE_PROVIDER).toLowerCase();
  }
  if (process.env.R2_ACCOUNT_ID && process.env.R2_ACCESS_KEY_ID && process.env.R2_SECRET_ACCESS_KEY) {
    return 'r2';
  }
  if (process.env.S3_BACKUP_BUCKET && process.env.AWS_ACCESS_KEY_ID) {
    return 's3';
  }
  return 'local';
}

function bucketName() {
  return process.env.R2_BACKUP_BUCKET
    || process.env.S3_BACKUP_BUCKET
    || process.env.BACKUP_BUCKET
    || 'bisonstechs-backups';
}

function s3ClientConfig() {
  const provider = configuredProvider();
  if (provider === 'r2') {
    const accountId = process.env.R2_ACCOUNT_ID;
    return {
      region: process.env.R2_REGION || 'auto',
      endpoint: process.env.R2_ENDPOINT || `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: process.env.R2_ACCESS_KEY_ID,
        secretAccessKey: process.env.R2_SECRET_ACCESS_KEY,
      },
      forcePathStyle: true,
    };
  }
  return {
    region: process.env.AWS_REGION || process.env.S3_BACKUP_REGION || 'us-east-1',
    endpoint: process.env.S3_BACKUP_ENDPOINT || undefined,
    credentials: process.env.AWS_ACCESS_KEY_ID
      ? {
          accessKeyId: process.env.AWS_ACCESS_KEY_ID,
          secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY,
        }
      : undefined,
    forcePathStyle: Boolean(process.env.S3_FORCE_PATH_STYLE),
  };
}

async function getS3() {
  const { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
  const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
  const client = new S3Client(s3ClientConfig());
  return { client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand, getSignedUrl };
}

async function ensureLocalDir(key) {
  const full = path.join(LOCAL_ROOT, key);
  await fsp.mkdir(path.dirname(full), { recursive: true });
  return full;
}

/**
 * Upload a local file to object storage. Returns { provider, key, sizeBytes }.
 */
async function uploadFile(localPath, key, contentType = 'application/zip') {
  const provider = configuredProvider();
  const stat = await fsp.stat(localPath);
  const sizeBytes = Number(stat.size);

  if (provider === 'local') {
    const dest = await ensureLocalDir(key);
    await fsp.copyFile(localPath, dest);
    return { provider: 'local', key, sizeBytes };
  }

  const { client, PutObjectCommand } = await getS3();
  const body = fs.createReadStream(localPath);
  await client.send(new PutObjectCommand({
    Bucket: bucketName(),
    Key: key,
    Body: body,
    ContentType: contentType,
    ServerSideEncryption: process.env.BACKUP_SSE || undefined,
  }));
  return { provider, key, sizeBytes };
}

/**
 * Download object to a local path.
 */
async function downloadToFile(key, destPath) {
  const provider = configuredProvider();
  await fsp.mkdir(path.dirname(destPath), { recursive: true });

  if (provider === 'local') {
    const src = path.join(LOCAL_ROOT, key);
    await fsp.copyFile(src, destPath);
    return destPath;
  }

  const { client, GetObjectCommand } = await getS3();
  const out = await client.send(new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  }));
  await pipeline(out.Body, fs.createWriteStream(destPath));
  return destPath;
}

/**
 * Create a short-lived signed download URL (or local file:// style path for local).
 * For local/dev, returns null and callers should stream via the API.
 */
async function getSignedDownloadUrl(key, expiresInSeconds = 300, fileName) {
  const provider = configuredProvider();
  if (provider === 'local') {
    return null;
  }
  const { client, GetObjectCommand, getSignedUrl } = await getS3();
  const command = new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
    ResponseContentDisposition: fileName
      ? `attachment; filename="${String(fileName).replace(/"/g, '')}"`
      : undefined,
  });
  return getSignedUrl(client, command, { expiresIn: expiresInSeconds });
}

async function deleteObject(key) {
  if (!key) return;
  const provider = configuredProvider();
  if (provider === 'local') {
    const full = path.join(LOCAL_ROOT, key);
    try {
      await fsp.unlink(full);
    } catch (err) {
      if (err.code !== 'ENOENT') throw err;
    }
    return;
  }
  const { client, DeleteObjectCommand } = await getS3();
  await client.send(new DeleteObjectCommand({
    Bucket: bucketName(),
    Key: key,
  }));
}

async function openReadStream(key) {
  const provider = configuredProvider();
  if (provider === 'local') {
    return fs.createReadStream(path.join(LOCAL_ROOT, key));
  }
  const { client, GetObjectCommand } = await getS3();
  const out = await client.send(new GetObjectCommand({
    Bucket: bucketName(),
    Key: key,
  }));
  return out.Body instanceof Readable ? out.Body : Readable.from(out.Body);
}

async function objectExists(key) {
  const provider = configuredProvider();
  if (provider === 'local') {
    try {
      await fsp.access(path.join(LOCAL_ROOT, key));
      return true;
    } catch {
      return false;
    }
  }
  try {
    const { client, HeadObjectCommand } = await getS3();
    await client.send(new HeadObjectCommand({ Bucket: bucketName(), Key: key }));
    return true;
  } catch {
    return false;
  }
}

module.exports = {
  configuredProvider,
  bucketName,
  uploadFile,
  downloadToFile,
  getSignedDownloadUrl,
  deleteObject,
  openReadStream,
  objectExists,
  LOCAL_ROOT,
};
