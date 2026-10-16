import { Request, Response } from 'express';
import { filesService } from './files.service';

export class FilesController {
  async upload(req: Request, res: Response): Promise<void> {
    const orgId = req.params.orgId as string;
    const userId = req.user!.id;
    const file = req.file;

    const uploaded = await filesService.uploadFile({
      orgId,
      userId,
      file,
      ip: req.ip,
    });

    res.status(201).json({ file: uploaded });
  }
}

export const filesController = new FilesController();
