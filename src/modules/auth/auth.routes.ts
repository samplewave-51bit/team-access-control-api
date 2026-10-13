import { Router } from 'express';
import { rateLimitConfigs } from '../../config/rateLimits';
import { authenticate } from '../../middleware/authenticate';
import { createRateLimiterMiddleware } from '../../middleware/rateLimit';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { loginSchema, registerSchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post(
  '/register',
  createRateLimiterMiddleware(rateLimitConfigs.register),
  validate(registerSchema),
  (req, res, next) => {
    authController.register(req, res).catch(next);
  },
);

authRouter.post(
  '/login',
  createRateLimiterMiddleware(rateLimitConfigs.login),
  validate(loginSchema),
  (req, res, next) => {
    authController.login(req, res).catch(next);
  },
);

authRouter.post('/refresh', (req, res, next) => {
  authController.refresh(req, res).catch(next);
});

authRouter.post('/logout', authenticate, (req, res, next) => {
  authController.logout(req, res).catch(next);
});

authRouter.post('/logout-all', authenticate, (req, res, next) => {
  authController.logoutAll(req, res).catch(next);
});

authRouter.get('/me', authenticate, (req, res, next) => {
  authController.me(req, res).catch(next);
});
