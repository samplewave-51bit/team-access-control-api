import crypto from 'crypto';
import request from 'supertest';
import { app } from '../../../src/app';
import { storage } from '../../../src/lib/storage';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';
import { startTestS3, stopTestS3 } from '../../helpers/s3';

describe('Files Module: Secure Multipart Upload (C20)', () => {
  beforeAll(async () => {
    await startTestS3();
  });

  afterAll(async () => {
    await stopTestS3();
    await disconnectDatabase();
  });

  beforeEach(async () => {
    await resetDatabase();
  });

  // Valid file fixtures
  const validPngBuffer = Buffer.from(
    '89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000a49444154789c63000100000500010d0a2db40000000049454e44ae426082',
    'hex',
  );
  const validJpegBuffer = Buffer.from(
    'ffd8ffe000104a46494600010101006000600000ffdb004300080606070605080707070909080a0c140d0c0b0b0c1912130f141d1a1f1e1d1a1c1c20242e2720222c231c1c2837292c30313434341f27393d38323c2e333432ffc0000b080001000101011100ffda0008010100003f00d2cf20ffd9',
    'hex',
  );
  const validPdfBuffer = Buffer.from(
    '%PDF-1.4\n1 0 obj\n<< /Type /Catalog >>\nendobj\ntrailer\n<< /Root 1 0 R >>\n%%EOF',
  );
  const validTextBuffer = Buffer.from(
    'Plain text report document content for team access control.',
  );

  // Spoofed file fixtures
  const fakePngWithExe = Buffer.from(
    '4d5a90000300000004000000ffff0000b800000000000000400000000000000000000000',
    'hex',
  );
  const textWithNullBytes = Buffer.from('Normal text header\x00\x01\x02binary payload');

  async function createTestUser(email: string, name = 'Test User') {
    const res = await request(app)
      .post('/api/v1/auth/register')
      .send({ email, name, password: 'SecurePassword123!' });
    const loginRes = await request(app)
      .post('/api/v1/auth/login')
      .send({ email, password: 'SecurePassword123!' });
    return {
      user: res.body.user,
      accessToken: loginRes.body.accessToken as string,
    };
  }

  async function setupOrgWithOwner() {
    const owner = await createTestUser('owner.files@example.com', 'File Owner');
    const orgRes = await request(app)
      .post('/api/v1/orgs')
      .set('Authorization', `Bearer ${owner.accessToken}`)
      .send({ name: 'File Storage Org' });
    const orgId = orgRes.body.organization.id as string;
    return { owner, orgId };
  }

  describe('Successful File Uploads', () => {
    it('successfully uploads a PNG image, stores in S3, creates DB record in PENDING_SCAN, and logs audit', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const expectedSha256 = crypto.createHash('sha256').update(validPngBuffer).digest('hex');

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validPngBuffer, {
          filename: 'diagram.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(201);
      expect(res.body.file).toBeDefined();
      const file = res.body.file;
      expect(file.orgId).toBe(orgId);
      expect(file.uploadedById).toBe(owner.user.id);
      expect(file.originalName).toBe('diagram.png');
      expect(file.mimeType).toBe('image/png');
      expect(file.sizeBytes).toBe(validPngBuffer.length);
      expect(file.sha256).toBe(expectedSha256);
      expect(file.status).toBe('PENDING_SCAN');

      // Verify row exists in DB
      const dbFile = await testPrisma.file.findUnique({ where: { id: file.id } });
      expect(dbFile).not.toBeNull();
      expect(dbFile!.storageKey).toBe(`orgs/${orgId}/${file.id}`);
      expect(dbFile!.status).toBe('PENDING_SCAN');

      // Verify object exists in S3 storage
      const existsInStorage = await storage.exists(dbFile!.storageKey);
      expect(existsInStorage).toBe(true);

      // Verify audit log entry was created
      const auditLog = await testPrisma.auditLog.findFirst({
        where: { orgId, action: 'file.upload', targetId: file.id },
      });
      expect(auditLog).not.toBeNull();
      expect(auditLog!.targetType).toBe('file');
      expect(auditLog!.actorId).toBe(owner.user.id);
      expect((auditLog!.metadata as Record<string, unknown>).sha256).toBe(expectedSha256);
    });

    it('successfully uploads a valid JPEG image', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validJpegBuffer, {
          filename: 'photo.jpg',
          contentType: 'image/jpeg',
        });

      expect(res.status).toBe(201);
      expect(res.body.file.mimeType).toBe('image/jpeg');
    });

    it('successfully uploads a valid PDF document', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validPdfBuffer, {
          filename: 'contract.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(201);
      expect(res.body.file.mimeType).toBe('application/pdf');
    });

    it('successfully uploads a clean UTF-8 text/plain document', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validTextBuffer, {
          filename: 'notes.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(201);
      expect(res.body.file.mimeType).toBe('text/plain');
    });
  });

  describe('Security & Validation Error Handling', () => {
    it('returns 413 Payload Too Large when file size exceeds 5 MB limit', async () => {
      const { owner, orgId } = await setupOrgWithOwner();
      // 5 MB + 1 byte
      const oversizeBuffer = Buffer.alloc(5 * 1024 * 1024 + 1);

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', oversizeBuffer, {
          filename: 'huge.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
    });

    it('returns 415 Unsupported Media Type when MIME is spoofed (EXE renamed to .png)', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', fakePngWithExe, {
          filename: 'innocent.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('returns 415 Unsupported Media Type when text/plain contains binary null bytes', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', textWithNullBytes, {
          filename: 'sneaky.txt',
          contentType: 'text/plain',
        });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('returns 415 Unsupported Media Type for non-allowlisted declared MIME (e.g. video/mp4)', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', Buffer.from('video data'), {
          filename: 'clip.mp4',
          contentType: 'video/mp4',
        });

      expect(res.status).toBe(415);
      expect(res.body.error.code).toBe('UNSUPPORTED_MEDIA_TYPE');
    });

    it('returns 400 Bad Request when filename has dangerous double extension (a.php.png)', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', validPngBuffer, {
          filename: 'a.php.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('double extension');
    });

    it('returns 400 Bad Request when filename has path traversal sequence (../../x)', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const boundary = '----WebKitFormBoundaryTest1234';
      const body = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="../../x"\r\nContent-Type: image/png\r\n\r\n`,
        ),
        validPngBuffer,
        Buffer.from(`\r\n--${boundary}--\r\n`),
      ]);

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .set('Content-Type', `multipart/form-data; boundary=${boundary}`)
        .send(body);

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('path traversal');
    });

    it('returns 400 Bad Request when uploaded file is empty (0 bytes)', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', Buffer.alloc(0), {
          filename: 'empty.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
      expect(res.body.error.message).toContain('empty');
    });

    it('returns 400 Bad Request when wrong field name is used (not "file")', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('attachment', validPngBuffer, {
          filename: 'doc.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe('VALIDATION_ERROR');
    });

    it('returns 401 Unauthorized when request lacks bearer token', async () => {
      const { orgId } = await setupOrgWithOwner();

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .attach('file', validPngBuffer, {
          filename: 'test.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(401);
      expect(res.body.error.code).toBe('UNAUTHORIZED');
    });

    it('returns 404 Not Found for non-member to prevent tenant leak', async () => {
      const { orgId } = await setupOrgWithOwner();
      const outsider = await createTestUser('outsider.files@example.com');

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${outsider.accessToken}`)
        .attach('file', validPngBuffer, {
          filename: 'test.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(404);
      expect(res.body.error.code).toBe('NOT_FOUND');
    });

    it('returns 403 Forbidden for member whose role lacks file:upload (e.g. viewer)', async () => {
      const { orgId } = await setupOrgWithOwner();
      const viewerUser = await createTestUser('viewer.files@example.com');

      const viewerRole = await testPrisma.role.findFirst({
        where: { orgId, name: 'viewer' },
      });

      await testPrisma.membership.create({
        data: {
          orgId,
          userId: viewerUser.user.id,
          roleId: viewerRole!.id,
        },
      });

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${viewerUser.accessToken}`)
        .attach('file', validPngBuffer, {
          filename: 'viewer.png',
          contentType: 'image/png',
        });

      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe('FORBIDDEN');
    });

    it('enforces 50 MB per-org quota inside transaction and rejects upload with 413', async () => {
      const { owner, orgId } = await setupOrgWithOwner();

      // Pre-seed org with files reaching 49.9 MB
      const prefillBytes = BigInt(Math.floor(49.9 * 1024 * 1024));
      await testPrisma.file.create({
        data: {
          orgId,
          uploadedById: owner.user.id,
          storageKey: `orgs/${orgId}/prefill-file`,
          originalName: 'big-data.bin',
          mimeType: 'application/pdf',
          sizeBytes: prefillBytes,
          sha256: 'mocksha256prefill',
          status: 'CLEAN',
        },
      });

      // Attempt uploading a 1 MB file (49.9 + 1 = 50.9 MB > 50 MB quota)
      const oneMbPdf = Buffer.concat([validPdfBuffer, Buffer.alloc(1024 * 1024)]);

      const res = await request(app)
        .post(`/api/v1/orgs/${orgId}/files`)
        .set('Authorization', `Bearer ${owner.accessToken}`)
        .attach('file', oneMbPdf, {
          filename: 'exceed-quota.pdf',
          contentType: 'application/pdf',
        });

      expect(res.status).toBe(413);
      expect(res.body.error.code).toBe('PAYLOAD_TOO_LARGE');
      expect(res.body.error.message).toContain('quota');
    });
  });
});
