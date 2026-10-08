import { Request, Response } from 'express';
import { ListMembersQuery } from './members.schemas';
import { membersService } from './members.service';

export class MembersController {
  async list(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await membersService.listMembers(
      orgId,
      req.query as unknown as ListMembersQuery,
    );
    res.status(200).json(result);
  }
}

export const membersController = new MembersController();
