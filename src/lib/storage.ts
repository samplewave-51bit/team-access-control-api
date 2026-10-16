import {
  CreateBucketCommand,
  DeleteObjectCommand,
  GetObjectCommand,
  HeadBucketCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl as awsGetSignedUrl } from '@aws-sdk/s3-request-presigner';
import { env } from '../config/env';
import { logger } from './logger';

export interface StoragePutParams {
  key: string;
  body: Buffer;
  contentType: string;
  metadata?: Record<string, string>;
}

export interface StoragePutResult {
  key: string;
  eTag?: string;
}

export interface StorageSignedUrlOptions {
  expiresIn?: number; // expiration in seconds, default 60s
  filename?: string;
}

export interface StorageProvider {
  put(params: StoragePutParams): Promise<StoragePutResult>;
  getSignedUrl(key: string, options?: StorageSignedUrlOptions): Promise<string>;
  delete(key: string): Promise<void>;
  exists(key: string): Promise<boolean>;
  ensureBucket(): Promise<void>;
}

export class S3StorageProvider implements StorageProvider {
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(client?: S3Client, bucket?: string) {
    this.bucket = bucket ?? env.S3_BUCKET;

    // Use IPv4 loopback for localhost endpoints to avoid IPv6 ECONNREFUSED under Node 18+
    let endpoint = env.S3_ENDPOINT;
    if (endpoint.includes('localhost')) {
      endpoint = endpoint.replace('localhost', '127.0.0.1');
    }

    // Default region for local development and S3 emulator compatibility
    const region =
      env.S3_REGION === 'auto' && (endpoint.includes('localhost') || endpoint.includes('127.0.0.1'))
        ? 'us-east-1'
        : env.S3_REGION;

    this.client =
      client ??
      new S3Client({
        endpoint,
        region,
        credentials: {
          accessKeyId: env.S3_ACCESS_KEY,
          secretAccessKey: env.S3_SECRET_KEY,
        },
        forcePathStyle: env.S3_FORCE_PATH_STYLE,
      });
  }

  /**
   * Ensures the target bucket exists, creating it if absent.
   */
  async ensureBucket(): Promise<void> {
    try {
      await this.client.send(new HeadBucketCommand({ Bucket: this.bucket }));
      logger.info({ bucket: this.bucket }, 'S3 storage bucket exists');
    } catch (err: unknown) {
      const error = err as {
        name?: string;
        Code?: string;
        $metadata?: { httpStatusCode?: number };
      };
      const statusCode = error.$metadata?.httpStatusCode;

      if (
        error.name === 'NotFound' ||
        error.name === 'NoSuchBucket' ||
        error.Code === 'NoSuchBucket' ||
        statusCode === 404
      ) {
        logger.info({ bucket: this.bucket }, 'Creating missing S3 storage bucket');
        try {
          await this.client.send(new CreateBucketCommand({ Bucket: this.bucket }));
          logger.info({ bucket: this.bucket }, 'S3 storage bucket created successfully');
        } catch (createErr: unknown) {
          const cErr = createErr as {
            name?: string;
            Code?: string;
            $metadata?: { httpStatusCode?: number };
          };
          if (
            cErr.name === 'BucketAlreadyExists' ||
            cErr.name === 'BucketAlreadyOwnedByYou' ||
            cErr.Code === 'BucketAlreadyExists' ||
            cErr.Code === 'BucketAlreadyOwnedByYou' ||
            cErr.$metadata?.httpStatusCode === 409
          ) {
            return;
          }
          throw createErr;
        }
      } else if (
        error.name === 'BucketAlreadyExists' ||
        error.name === 'BucketAlreadyOwnedByYou' ||
        error.Code === 'BucketAlreadyExists' ||
        error.Code === 'BucketAlreadyOwnedByYou' ||
        statusCode === 409
      ) {
        return;
      } else {
        logger.error({ err, bucket: this.bucket }, 'Error checking S3 storage bucket');
        throw err;
      }
    }
  }

  /**
   * Uploads an object buffer to S3 storage.
   */
  async put(params: StoragePutParams): Promise<StoragePutResult> {
    const command = new PutObjectCommand({
      Bucket: this.bucket,
      Key: params.key,
      Body: params.body,
      ContentType: params.contentType,
      Metadata: params.metadata,
    });

    const response = await this.client.send(command);

    return {
      key: params.key,
      eTag: response.ETag?.replace(/"/g, ''),
    };
  }

  /**
   * Generates a short-lived (default 60s) pre-signed URL for GET download.
   */
  async getSignedUrl(key: string, options?: StorageSignedUrlOptions): Promise<string> {
    const expiresIn = options?.expiresIn ?? 60;
    const contentDisposition = options?.filename
      ? `attachment; filename="${encodeURIComponent(options.filename)}"`
      : 'attachment';

    const command = new GetObjectCommand({
      Bucket: this.bucket,
      Key: key,
      ResponseContentDisposition: contentDisposition,
    });

    return awsGetSignedUrl(this.client, command, { expiresIn });
  }

  /**
   * Deletes an object from S3 storage by key.
   */
  async delete(key: string): Promise<void> {
    const command = new DeleteObjectCommand({
      Bucket: this.bucket,
      Key: key,
    });

    await this.client.send(command);
  }

  /**
   * Checks whether an object exists in S3 storage by key.
   */
  async exists(key: string): Promise<boolean> {
    try {
      const command = new HeadObjectCommand({
        Bucket: this.bucket,
        Key: key,
      });
      await this.client.send(command);
      return true;
    } catch (err: unknown) {
      const error = err as { name?: string; $metadata?: { httpStatusCode?: number } };
      if (
        error.name === 'NotFound' ||
        error.name === 'NoSuchKey' ||
        error.$metadata?.httpStatusCode === 404
      ) {
        return false;
      }
      throw err;
    }
  }
}

export const storage: StorageProvider = new S3StorageProvider();
