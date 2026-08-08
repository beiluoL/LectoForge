import type { FastifyReply, FastifyRequest } from 'fastify';
import * as palaceService from '../services/palaceService';
import type { CreateLociDTO, CreatePalaceDTO, UpdateLociDTO, UpdatePalaceDTO } from '../types/palace';

interface IdParams {
  id: string;
}
interface PalaceIdParams {
  palaceId: string;
}

export async function list() {
  return palaceService.listPalaces();
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = palaceService.getPalaceWithLoci(id);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreatePalaceDTO;
  if (!b.name) return reply.code(400).send({ message: 'name required' });
  return palaceService.createPalace(b);
}

export async function update(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as UpdatePalaceDTO;
  const vo = palaceService.updatePalace(id, b);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  palaceService.deletePalace(id);
  return reply.code(204).send();
}

export async function listLoci(req: FastifyRequest) {
  const palaceId = Number((req.params as PalaceIdParams).palaceId);
  return palaceService.listLoci(palaceId);
}

export async function createLoci(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateLociDTO;
  if (!b.name || b.palaceId === undefined) {
    return reply.code(400).send({ message: 'palaceId & name required' });
  }
  return palaceService.createLoci(b);
}

export async function updateLoci(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as UpdateLociDTO;
  const vo = palaceService.updateLoci(id, b);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function listDue(req: FastifyRequest) {
  const id = Number((req.params as IdParams).id);
  return palaceService.listDueLoci(id);
}

export async function removeLoci(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  palaceService.deleteLoci(id);
  return reply.code(204).send();
}
