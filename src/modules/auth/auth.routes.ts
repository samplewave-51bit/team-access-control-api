import { Router } from 'express';
import { validate } from '../../middleware/validate';
import { authController } from './auth.controller';
import { registerSchema } from './auth.schemas';

export const authRouter = Router();

authRouter.post('/register', validate(registerSchema), (req, res, next) => {
  authController.register(req, res).catch(next);
});
