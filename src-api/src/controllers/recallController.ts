import type { FastifyReply, FastifyRequest } from 'fastify';
import * as recallService from '../services/recallService';
import type { CreateRecallDTO, SubmitRecallDTO } from '../types/recall';

interface IdParams {
  id: string;
}

export async function list() {
  return recallService.listRecallSessions();
}

export async function detail(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const vo = recallService.findRecallSession(id);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateRecallDTO;
  if (!b.sourceText || !String(b.sourceText).trim()) {
    return reply.code(400).send({ message: 'sourceText required' });
  }
  return recallService.createRecallSession(b);
}

export async function submit(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  const b = req.body as SubmitRecallDTO;
  const round = b.round == null ? 1 : Number(b.round);
  if (round < 1 || round > 3) return reply.code(400).send({ message: 'round must be 1-3' });
  if (!b.text || !String(b.text).trim()) return reply.code(400).send({ message: 'text required' });
  const vo = recallService.submitRecallRound(id, round, b.text);
  if (!vo) return reply.code(404).send({ message: 'not found' });
  return vo;
}

export async function remove(req: FastifyRequest, reply: FastifyReply) {
  const id = Number((req.params as IdParams).id);
  recallService.deleteRecallSession(id);
  return reply.code(204).send();
}
