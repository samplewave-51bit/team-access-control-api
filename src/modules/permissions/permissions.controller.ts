import { Request, Response } from 'express';
import { permissionsService } from './permissions.service';

export class PermissionsController {
  async list(_req: Request, res: Response): Promise<void> {
    const permissions = await permissionsService.listPermissions();
    res.status(200).json({ permissions });
  }
}

export const permissionsController = new PermissionsController();
