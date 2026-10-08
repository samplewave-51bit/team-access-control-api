import { Router } from 'express';
import { authenticate } from '../../middleware/authenticate';
import { permissionsController } from './permissions.controller';

export const permissionsRouter = Router();

permissionsRouter.get('/', authenticate, (req, res, next) => {
  permissionsController.list(req, res).catch(next);
});
