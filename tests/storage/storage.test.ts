import http from 'http';
import { storage } from '../../src/lib/storage';
import { startTestS3, stopTestS3 } from '../helpers/s3';

describe('Storage Provider Integration (C19)', () => {
  beforeAll(async () => {
    await startTestS3();
  });

  afterAll(async () => {
    await stopTestS3();
  });

  const testKey = 'test-org/documents/sample-file.txt';
  const testContent = Buffer.from('Hello, S3-compatible storage provider!');
  const testContentType = 'text/plain';

  it('bootstraps the bucket with ensureBucket()', async () => {
    await expect(storage.ensureBucket()).resolves.not.toThrow();
  });

  it('puts an object into storage and returns key and eTag', async () => {
    const result = await storage.put({
      key: testKey,
      body: testContent,
      contentType: testContentType,
      metadata: { 'test-meta': 'active' },
    });

    expect(result.key).toBe(testKey);
    expect(result.eTag).toBeDefined();
  });

  it('checks object existence with exists()', async () => {
    const exists = await storage.exists(testKey);
    expect(exists).toBe(true);

    const nonExistent = await storage.exists('non-existent-key-12345');
    expect(nonExistent).toBe(false);
  });

  it('generates a pre-signed download URL that can download the file', async () => {
    const signedUrl = await storage.getSignedUrl(testKey, {
      expiresIn: 60,
      filename: 'downloaded-sample.txt',
    });

    expect(signedUrl).toBeDefined();
    expect(signedUrl).toContain(testKey);

    // Fetch the signed URL using native http module to verify download works
    const downloadedBuffer = await new Promise<Buffer>((resolve, reject) => {
      http
        .get(signedUrl, (res) => {
          if (res.statusCode !== 200) {
            reject(new Error(`Failed with status code: ${res.statusCode}`));
            return;
          }
          const chunks: Buffer[] = [];
          res.on('data', (chunk) =>
            chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)),
          );
          res.on('end', () => resolve(Buffer.concat(chunks)));
          res.on('error', reject);
        })
        .on('error', reject);
    });

    expect(downloadedBuffer.toString('utf8')).toBe(testContent.toString('utf8'));
  });

  it('deletes an object and confirms exists() returns false', async () => {
    await storage.delete(testKey);
    const existsAfterDelete = await storage.exists(testKey);
    expect(existsAfterDelete).toBe(false);
  });
});
