import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { loginSchema, registerSchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), (req, res, next) => {
  authController.register(req, res).catch(next);
});

authRouter.post('/login', validate(loginSchema), (req, res, next) => {
  authController.login(req, res).catch(next);
});

authRouter.get('/me', authenticate, (req, res, next) => {
  authController.me(req, res).catch(next);
});
