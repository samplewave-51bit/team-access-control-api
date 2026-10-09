import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { requirePermission } from '../../middleware/requirePermission';
import { validate } from '../../middleware/validate';
import { rolesController } from './roles.controller';
import {
  createRoleSchema,
  deleteRoleSchema,
  getRolesSchema,
  updateRoleSchema,
} from './roles.schemas';

export const rolesRouter = Router({ mergeParams: true });

rolesRouter.get(
  '/',
  authenticate,
  requirePermission('role:read'),
  validate(getRolesSchema),
  (req, res, next) => {
    rolesController.list(req, res).catch(next);
  },
);

rolesRouter.post(
  '/',
  authenticate,
  requirePermission('role:manage'),
  validate(createRoleSchema),
  (req, res, next) => {
    rolesController.create(req, res).catch(next);
  },
);

rolesRouter.patch(
  '/:roleId',
  authenticate,
  requirePermission('role:manage'),
  validate(updateRoleSchema),
  (req, res, next) => {
    rolesController.update(req, res).catch(next);
  },
);

rolesRouter.delete(
  '/:roleId',
  authenticate,
  requirePermission('role:manage'),
  validate(deleteRoleSchema),
  (req, res, next) => {
    rolesController.delete(req, res).catch(next);
  },
);
