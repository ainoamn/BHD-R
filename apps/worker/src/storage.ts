import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
  type PutObjectCommandInput,
} from '@aws-sdk/client-s3';
import type { WorkerConfig } from './config.js';

export interface StorageAdapter {
  get(bucket: string, key: string): Promise<Uint8Array>;
  putPrivate(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void>;
  putPublic(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void>;
  deletePrivate(key: string): Promise<void>;
}

export class ObjectStorage implements StorageAdapter {
  private readonly client: S3Client;

  constructor(private readonly config: WorkerConfig) {
    this.client = new S3Client({
      ...(config.S3_ENDPOINT ? { endpoint: config.S3_ENDPOINT } : {}),
      region: config.S3_REGION,
      forcePathStyle: config.S3_FORCE_PATH_STYLE === 'true',
      credentials: {
        accessKeyId: config.S3_ACCESS_KEY,
        secretAccessKey: config.S3_SECRET_KEY,
      },
    });
  }

  async get(bucket: string, key: string): Promise<Uint8Array> {
    const response = await this.client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    if (!response.Body) throw new Error('Object has no body');
    return response.Body.transformToByteArray();
  }

  async putPrivate(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.put({
      Bucket: this.config.S3_BUCKET_PRIVATE,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'private, no-store',
      ServerSideEncryption: 'AES256',
      ...(metadata ? { Metadata: metadata } : {}),
    });
  }

  async putPublic(
    key: string,
    body: Uint8Array,
    contentType: string,
    metadata?: Record<string, string>,
  ): Promise<void> {
    await this.put({
      Bucket: this.config.S3_BUCKET_PUBLIC,
      Key: key,
      Body: body,
      ContentType: contentType,
      CacheControl: 'public, max-age=31536000, immutable',
      ...(metadata ? { Metadata: metadata } : {}),
    });
  }

  async deletePrivate(key: string): Promise<void> {
    await this.client.send(
      new DeleteObjectCommand({ Bucket: this.config.S3_BUCKET_PRIVATE, Key: key }),
    );
  }

  private async put(input: PutObjectCommandInput): Promise<void> {
    await this.client.send(new PutObjectCommand(input));
  }
}
