import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { validate } from '../../middleware/validate';
import { sessionsController } from './sessions.controller';
import { deleteSessionSchema, getSessionsSchema } from './sessions.schemas';

export const sessionsRouter = Router();

sessionsRouter.get('/', authenticate, validate(getSessionsSchema), (req, res, next) => {
  sessionsController.listOwn(req, res).catch(next);
});

sessionsRouter.delete('/:id', authenticate, validate(deleteSessionSchema), (req, res, next) => {
  sessionsController.revokeOwn(req, res).catch(next);
});
