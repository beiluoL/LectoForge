import type { FastifyReply, FastifyRequest } from 'fastify';
import * as categoryService from '../services/categoryService';
import type { CreateCategoryDTO } from '../types/category';

export async function tree() {
  return categoryService.listCategories();
}

export async function create(req: FastifyRequest, reply: FastifyReply) {
  const b = req.body as CreateCategoryDTO;
  if (!b.name) return reply.code(400).send({ error: 'name required' });
  const row = categoryService.createCategory(b);
  return reply.code(201).send(row);
}
