import { Request, Response } from 'express';
import {
  AcceptInvitationInput,
  CreateInvitationInput,
  ListInvitationsQuery,
} from './invitations.schemas';
import { invitationsService } from './invitations.service';

export class InvitationsController {
  async create(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await invitationsService.createInvitation(
      orgId,
      req.membership!,
      req.user!.id,
      req.body as CreateInvitationInput,
    );
    res.status(201).json(result);
  }

  async list(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await invitationsService.listInvitations(
      orgId,
      req.query as unknown as ListInvitationsQuery,
    );
    res.status(200).json(result);
  }

  async revoke(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const id = Array.isArray(req.params.id) ? req.params.id[0] : req.params.id;
    const result = await invitationsService.revokeInvitation(orgId, id, req.membership!);
    res.status(200).json(result);
  }

  async accept(req: Request, res: Response): Promise<void> {
    const result = await invitationsService.acceptInvitation(
      req.user!.id,
      req.user!.email,
      req.body as AcceptInvitationInput,
    );
    res.status(200).json(result);
  }
}

export const invitationsController = new InvitationsController();
