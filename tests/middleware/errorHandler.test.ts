import express from 'express';
import request from 'supertest';
import {
  ConflictError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
  ValidationError,
} from '../../src/lib/errors';
import { errorHandler } from '../../src/middleware/errorHandler';
import { requestIdMiddleware } from '../../src/middleware/requestId';

describe('Central Error Handler', () => {
  function createTestApp(errorToThrow: Error) {
    const testApp = express();
    testApp.use(requestIdMiddleware);
    testApp.get('/test-error', () => {
      throw errorToThrow;
    });
    testApp.use(errorHandler);
    return testApp;
  }

  it('should format ValidationError correctly with 400', async () => {
    const app = createTestApp(new ValidationError('Invalid email format', [{ field: 'email' }]));
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(400);
    expect(res.body).toEqual({
      error: {
        code: 'VALIDATION_ERROR',
        message: 'Invalid email format',
        details: [{ field: 'email' }],
        requestId: expect.any(String),
      },
    });
  });

  it('should format UnauthorizedError correctly with 401', async () => {
    const app = createTestApp(new UnauthorizedError());
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHORIZED');
  });

  it('should format ForbiddenError correctly with 403', async () => {
    const app = createTestApp(new ForbiddenError());
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('should format NotFoundError correctly with 404', async () => {
    const app = createTestApp(new NotFoundError('User not found'));
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe('NOT_FOUND');
  });

  it('should format ConflictError correctly with 409', async () => {
    const app = createTestApp(new ConflictError('Email already in use'));
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe('CONFLICT');
  });

  it('should format unexpected errors with 500 and INTERNAL_SERVER_ERROR', async () => {
    const app = createTestApp(new Error('Unexpected database explosion'));
    const res = await request(app).get('/test-error');

    expect(res.status).toBe(500);
    expect(res.body).toEqual({
      error: {
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Internal server error',
        details: [],
        requestId: expect.any(String),
      },
    });
  });
});
