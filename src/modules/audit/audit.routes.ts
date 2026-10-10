import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { auditController } from './audit.controller';
import { listAuditLogsSchema } from './audit.schemas';

export const auditRouter = Router({ mergeParams: true });

auditRouter.get(
  '/',
  authenticate,
  requirePermission('audit:read'),
  validate(listAuditLogsSchema),
  (req, res, next) => {
    auditController.list(req, res).catch(next);
  },
);
