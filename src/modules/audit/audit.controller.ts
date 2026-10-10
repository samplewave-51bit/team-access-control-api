import { Request, Response } from 'express';
import { ListAuditLogsQuery } from './audit.schemas';
import { auditService } from './audit.service';

export class AuditController {
  async list(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await auditService.listAuditLogs(
      orgId,
      req.query as unknown as ListAuditLogsQuery,
    );
    res.status(200).json(result);
  }
}

export const auditController = new AuditController();
