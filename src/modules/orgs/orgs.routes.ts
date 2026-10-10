import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { orgInvitationsRouter } from '../invitations/invitations.routes';
import { membersRouter } from '../members/members.routes';
import { rolesRouter } from '../roles/roles.routes';
import { orgsController } from './orgs.controller';
import { createOrgSchema, getOrgSchema, updateOrgSchema } from './orgs.schemas';

export const orgsRouter = Router();

orgsRouter.use('/:orgId/roles', rolesRouter);
orgsRouter.use('/:orgId/members', membersRouter);
orgsRouter.use('/:orgId/invitations', orgInvitationsRouter);

orgsRouter.post('/', authenticate, validate(createOrgSchema), (req, res, next) => {
  orgsController.create(req, res).catch(next);
});

orgsRouter.get('/', authenticate, (req, res, next) => {
  orgsController.list(req, res).catch(next);
});

orgsRouter.get('/:orgId', authenticate, validate(getOrgSchema), (req, res, next) => {
  orgsController.getById(req, res).catch(next);
});

orgsRouter.patch(
  '/:orgId',
  authenticate,
  requirePermission('org:update'),
  validate(updateOrgSchema),
  (req, res, next) => {
    orgsController.update(req, res).catch(next);
  },
);
