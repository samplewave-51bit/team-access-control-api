import { Request, Response } from 'express';
import { sessionsService } from './sessions.service';

export class SessionsController {
  async listOwn(req: Request, res: Response): Promise<void> {
    const userId = req.user!.id;
    const currentSessionId = req.session?.id;
    const result = await sessionsService.listUserSessions(userId, currentSessionId);
    res.status(200).json(result);
  }

  async revokeOwn(req: Request, res: Response): Promise<void> {
    const userId = req.user!.id;
    const sessionId = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await sessionsService.revokeUserSession(userId, sessionId);
    res.status(200).json(result);
  }

  async revokeMember(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const result = await sessionsService.revokeMemberSessions(orgId, userId, req.membership!);
    res.status(200).json(result);
  }
}

export const sessionsController = new SessionsController();
