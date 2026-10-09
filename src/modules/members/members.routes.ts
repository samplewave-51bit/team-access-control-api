import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { membersController } from './members.controller';
import { deleteMemberSchema, listMembersSchema, updateMemberRoleSchema } from './members.schemas';

export const membersRouter = Router({ mergeParams: true });

membersRouter.get(
  '/',
  authenticate,
  requirePermission('member:read'),
  validate(listMembersSchema),
  (req, res, next) => {
    membersController.list(req, res).catch(next);
  },
);

membersRouter.patch(
  '/:userId/role',
  authenticate,
  requirePermission('member:role.update'),
  validate(updateMemberRoleSchema),
  (req, res, next) => {
    membersController.updateRole(req, res).catch(next);
  },
);

membersRouter.delete(
  '/:userId',
  authenticate,
  requirePermission('member:remove'),
  validate(deleteMemberSchema),
  (req, res, next) => {
    membersController.remove(req, res).catch(next);
  },
);
