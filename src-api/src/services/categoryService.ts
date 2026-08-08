import { asc } from 'drizzle-orm';
import { db } from '../db';
import { categories } from '../db/schema';
import type { CreateCategoryDTO } from '../types/category';

type CategoryRow = typeof categories.$inferSelect;

export function listCategories(): CategoryRow[] {
  return db.select().from(categories).orderBy(asc(categories.sort), asc(categories.id)).all();
}

export function createCategory(b: CreateCategoryDTO): CategoryRow {
  return db
    .insert(categories)
    .values({ name: b.name, parentId: b.parentId ?? 0, sort: b.sort ?? 0 })
    .returning()
    .get();
}
