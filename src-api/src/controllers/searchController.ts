import type { FastifyRequest } from 'fastify';
import * as searchService from '../services/searchService';

export async function search(req: FastifyRequest) {
  const q = ((req.query as { q?: string })?.q ?? '').toString().trim();
  return searchService.search(q);
}
