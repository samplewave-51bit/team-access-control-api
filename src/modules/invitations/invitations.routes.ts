import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { invitationsController } from './invitations.controller';
import {
  acceptInvitationSchema,
  createInvitationSchema,
  deleteInvitationSchema,
  listInvitationsSchema,
} from './invitations.schemas';

// Scoped to /api/v1/orgs/:orgId/invitations
export const orgInvitationsRouter = Router({ mergeParams: true });

orgInvitationsRouter.post(
  '/',
  authenticate,
  requirePermission('member:invite'),
  validate(createInvitationSchema),
  (req, res, next) => {
    invitationsController.create(req, res).catch(next);
  },
);

orgInvitationsRouter.get(
  '/',
  authenticate,
  requirePermission('member:invite'),
  validate(listInvitationsSchema),
  (req, res, next) => {
    invitationsController.list(req, res).catch(next);
  },
);

orgInvitationsRouter.delete(
  '/:id',
  authenticate,
  requirePermission('member:invite'),
  validate(deleteInvitationSchema),
  (req, res, next) => {
    invitationsController.revoke(req, res).catch(next);
  },
);

// Scoped to /api/v1/invitations
export const invitationsRouter = Router();

invitationsRouter.post(
  '/accept',
  authenticate,
  validate(acceptInvitationSchema),
  (req, res, next) => {
    invitationsController.accept(req, res).catch(next);
  },
);
