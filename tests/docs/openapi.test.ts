import request from 'supertest';
import { app } from '../../src/app';

describe('OpenAPI & Swagger Documentation', () => {
  it('GET /docs/openapi.json should return valid OpenAPI 3.0 document containing registered routes', async () => {
    const res = await request(app).get('/docs/openapi.json');

    expect(res.status).toBe(200);
    expect(res.body.openapi).toBe('3.0.0');
    expect(res.body.info.title).toBe('Team Access Control API');
    expect(res.body.paths['/auth/register']).toBeDefined();
    expect(res.body.paths['/auth/register'].post).toBeDefined();
  });

  it('GET /docs should serve Swagger UI HTML', async () => {
    const res = await request(app).get('/docs/');

    expect(res.status).toBe(200);
    expect(res.text).toContain('Swagger UI');
  });
});
