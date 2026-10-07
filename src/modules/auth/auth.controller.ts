import { Request, Response } from 'express';
import { RegisterInput } from './auth.schemas';
import { authService } from './auth.service';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const user = await authService.register(req.body as RegisterInput);
    res.status(201).json({ user });
  }
}

export const authController = new AuthController();
