import fs from 'fs';
import path from 'path';
import S3rver from 's3rver';
import { env } from '../../src/config/env';
import { storage } from '../../src/lib/storage';

// eslint-disable-next-line @typescript-eslint/no-require-imports
const AWSAccount = require('s3rver/lib/models/account');

const s3Directory = path.join(__dirname, '../../.s3rver_test_data');

let s3Server: S3rver | null = null;

export async function startTestS3(): Promise<void> {
  if (s3Server) return;

  if (!fs.existsSync(s3Directory)) {
    fs.mkdirSync(s3Directory, { recursive: true });
  }

  // Register credentials in S3rver account registry
  AWSAccount.DUMMY_ACCOUNT.createKeyPair(env.S3_ACCESS_KEY, env.S3_SECRET_KEY);

  try {
    const server = new S3rver({
      port: 9000,
      address: '0.0.0.0',
      silent: true,
      directory: s3Directory,
      configureBuckets: [
        {
          name: env.S3_BUCKET,
        },
      ],
    });

    await server.run();
    s3Server = server;
  } catch (err: unknown) {
    const error = err as { code?: string };
    if (error.code !== 'EADDRINUSE') {
      throw err;
    }
  }

  await storage.ensureBucket();
}

export async function stopTestS3(): Promise<void> {
  if (s3Server) {
    await s3Server.close();
    s3Server = null;
  }
  if (fs.existsSync(s3Directory)) {
    try {
      fs.rmSync(s3Directory, { recursive: true, force: true });
    } catch {
      // Ignore cleanup error if file locked temporarily on Windows
    }
  }
}
