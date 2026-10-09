import { Request, Response } from 'express';
import { CreateRoleInput, UpdateRoleInput } from './roles.schemas';
import { rolesService } from './roles.service';

export class RolesController {
  async list(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await rolesService.listRoles(orgId);
    res.status(200).json(result);
  }

  async create(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const result = await rolesService.createRole(
      orgId,
      req.membership!,
      req.permissions!,
      req.body as CreateRoleInput,
    );
    res.status(201).json(result);
  }

  async update(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const roleId = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const result = await rolesService.updateRole(
      orgId,
      roleId,
      req.membership!,
      req.permissions!,
      req.body as UpdateRoleInput,
    );
    res.status(200).json(result);
  }

  async delete(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const roleId = Array.isArray(req.params.roleId) ? req.params.roleId[0] : req.params.roleId;
    const result = await rolesService.deleteRole(orgId, roleId, req.membership!);
    res.status(200).json(result);
  }
}

export const rolesController = new RolesController();
