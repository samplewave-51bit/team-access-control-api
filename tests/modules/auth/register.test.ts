import request from 'supertest';
import { app } from '../../../src/app';
import { disconnectDatabase, resetDatabase, testPrisma } from '../../helpers/db';

describe('POST /api/v1/auth/register', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  afterAll(async () => {
    await disconnectDatabase();
  });

  const validPayload = {
    email: 'newuser@example.com',
    name: 'New User',
    password: 'SafePassword123!',
  };

  it('should successfully register a new user with 201 Created and return user data', async () => {
    const res = await request(app).post('/api/v1/auth/register').send(validPayload);

    expect(res.status).toBe(201);
    expect(res.body.user).toBeDefined();
    expect(res.body.user.id).toBeDefined();
    expect(res.body.user.email).toBe('newuser@example.com');
    expect(res.body.user.name).toBe('New User');
    expect(res.body.user.createdAt).toBeDefined();
    expect(res.body.user.passwordHash).toBeUndefined();

    // Verify stored in database
    const dbUser = await testPrisma.user.findUnique({
      where: { email: 'newuser@example.com' },
    });
    expect(dbUser).not.toBeNull();
    expect(dbUser?.passwordHash).not.toBe('SafePassword123!');
  });

  it('should return 409 Conflict if email is already registered', async () => {
    // First registration
    await request(app).post('/api/v1/auth/register').send(validPayload);

    // Duplicate registration (case-insensitive)
    const duplicatePayload = {
      ...validPayload,
      email: 'NEWUSER@example.com',
    };

    const res = await request(app).post('/api/v1/auth/register').send(duplicatePayload);

    expect(res.status).toBe(409);
    expect(res.body.error).toBeDefined();
    expect(res.body.error.code).toBe('CONFLICT');
    expect(res.body.error.message).toBe('Email is already registered');
  });

  it('should return 400 Bad Request if password is less than 10 characters', async () => {
    const shortPasswordPayload = {
      ...validPayload,
      password: 'short',
    };

    const res = await request(app).post('/api/v1/auth/register').send(shortPasswordPayload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(
      true,
    );
  });

  it('should return 400 Bad Request if password equals email', async () => {
    const passwordEqualsEmailPayload = {
      ...validPayload,
      email: 'myemail@test.com',
      password: 'myemail@test.com',
    };

    const res = await request(app).post('/api/v1/auth/register').send(passwordEqualsEmailPayload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
    expect(res.body.error.details.some((d: { field: string }) => d.field === 'password')).toBe(
      true,
    );
  });

  it('should return 400 Bad Request if payload contains unknown extra fields (strict validation)', async () => {
    const extraFieldPayload = {
      ...validPayload,
      role: 'ADMIN',
      isAdmin: true,
    };

    const res = await request(app).post('/api/v1/auth/register').send(extraFieldPayload);

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe('VALIDATION_ERROR');
  });
});
