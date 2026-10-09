import { Request, Response } from 'express';
import { ListMembersQuery, UpdateMemberRoleInput } from './members.schemas';
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

  async updateRole(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const result = await membersService.updateMemberRole(
      orgId,
      userId,
      req.membership!,
      req.body as UpdateMemberRoleInput,
    );
    res.status(200).json(result);
  }

  async remove(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const userId = Array.isArray(req.params.userId) ? req.params.userId[0] : req.params.userId;
    const result = await membersService.removeMember(orgId, userId, req.membership!);
    res.status(200).json(result);
  }
}

export const membersController = new MembersController();
