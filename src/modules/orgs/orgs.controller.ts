import { Request, Response } from 'express';
import { CreateOrgInput, UpdateOrgInput } from './orgs.schemas';
import { orgsService } from './orgs.service';

export class OrgsController {
  async create(req: Request, res: Response): Promise<void> {
    const org = await orgsService.createOrg(req.user!.id, req.body as CreateOrgInput);
    res.status(201).json({ organization: org });
  }

  async list(req: Request, res: Response): Promise<void> {
    const organizations = await orgsService.listUserOrgs(req.user!.id);
    res.status(200).json({ organizations });
  }

  async getById(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const org = await orgsService.getOrgById(req.user!.id, orgId);
    res.status(200).json({ organization: org });
  }

  async update(req: Request, res: Response): Promise<void> {
    const orgId = Array.isArray(req.params.orgId) ? req.params.orgId[0] : req.params.orgId;
    const org = await orgsService.updateOrg(req.user!.id, orgId, req.body as UpdateOrgInput);
    res.status(200).json({ organization: org });
  }
}

export const orgsController = new OrgsController();
