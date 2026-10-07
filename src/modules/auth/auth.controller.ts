import { Request, Response } from 'express';
import { env } from '../../config/env';
import { LoginInput, RegisterInput } from './auth.schemas';
import { authService } from './auth.service';

export class AuthController {
  async register(req: Request, res: Response): Promise<void> {
    const user = await authService.register(req.body as RegisterInput);
    res.status(201).json({ user });
  }

  async login(req: Request, res: Response): Promise<void> {
    const result = await authService.login(req.body as LoginInput, {
      userAgent: req.header('user-agent'),
      ip: req.ip,
    });

    res.cookie('refreshToken', result.refreshToken, {
      httpOnly: true,
      secure: env.COOKIE_SECURE,
      sameSite: 'strict',
      path: '/api/v1/auth',
      maxAge: env.REFRESH_TOKEN_TTL_DAYS * 24 * 60 * 60 * 1000,
    });

    res.status(200).json({
      accessToken: result.accessToken,
      user: result.user,
    });
  }

  async me(req: Request, res: Response): Promise<void> {
    const user = req.user!;
    res.status(200).json({
      user: {
        id: user.id,
        email: user.email,
        name: user.name,
        createdAt: user.createdAt,
      },
    });
  }
}

export const authController = new AuthController();
