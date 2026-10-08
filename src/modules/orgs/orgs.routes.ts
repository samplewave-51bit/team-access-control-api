import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { orgsController } from './orgs.controller';
import { createOrgSchema, getOrgSchema, updateOrgSchema } from './orgs.schemas';

export const orgsRouter = Router();

orgsRouter.post('/', authenticate, validate(createOrgSchema), (req, res, next) => {
  orgsController.create(req, res).catch(next);
});

orgsRouter.get('/', authenticate, (req, res, next) => {
  orgsController.list(req, res).catch(next);
});

orgsRouter.get('/:orgId', authenticate, validate(getOrgSchema), (req, res, next) => {
  orgsController.getById(req, res).catch(next);
});

orgsRouter.patch('/:orgId', authenticate, validate(updateOrgSchema), (req, res, next) => {
  orgsController.update(req, res).catch(next);
});
