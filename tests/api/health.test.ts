import request from 'supertest';
import { app } from '../../src/app';

describe('GET /api/v1/health', () => {
  it('should return 200 OK with health status and requestId header', async () => {
    const res = await request(app).get('/api/v1/health');

    expect(res.status).toBe(200);
    expect(res.body).toEqual({
      status: 'ok',
      timestamp: expect.any(String),
      uptime: expect.any(Number),
    });
    expect(res.headers['x-request-id']).toBeDefined();
  });

  it('should preserve incoming X-Request-Id header', async () => {
    const customId = 'test-request-id-12345';
    const res = await request(app).get('/api/v1/health').set('x-request-id', customId);

    expect(res.status).toBe(200);
    expect(res.headers['x-request-id']).toBe(customId);
  });
});

describe('404 Not Found Handler', () => {
  it('should return 404 with standard error shape for unknown routes', async () => {
    const res = await request(app).get('/api/v1/unknown-endpoint');

    expect(res.status).toBe(404);
    expect(res.body).toEqual({
      error: {
        code: 'NOT_FOUND',
        message: 'Route GET /api/v1/unknown-endpoint not found',
        details: [],
        requestId: expect.any(String),
      },
    });
    expect(res.headers['x-request-id']).toBe(res.body.error.requestId);
  });
});
