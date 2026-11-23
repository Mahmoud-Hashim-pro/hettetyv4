/**
 * HETTETY Clean Architecture — Neon Property Repository
 *
 * Implements `IPropertyRepository` with strict Single Responsibility:
 * handles all Property persistence operations through `NeonClient` with ZERO
 * demo/fixture seeding (`PREMIER_LANDMARK_PROPERTIES` is never imported or injected).
 */

import type { Property, ResetPropertiesResult } from '../../core/domain/entities';
import type { IPropertyRepository } from '../../core/domain/repositories';
import { neonClient, type NeonClient, type QueryFilter } from './NeonClient';

const PROPERTIES_COLLECTION = 'properties';

function normalizePropertyRecord(raw: Record<string, unknown>): Property {
  return {
    ...(raw as unknown as Property),
    id: String(raw.id || ''),
    title: String(raw.title || ''),
    price: Number(raw.price ?? 0),
    location: String(raw.location || ''),
    bedrooms: Number(raw.bedrooms ?? 0),
    bathrooms: Number(raw.bathrooms ?? 0),
    area: Number(raw.area ?? 0),
    imageUrl: String(raw.imageUrl || ''),
    status: raw.status === 'For Rent' ? 'For Rent' : 'For Sale',
    isVerified: Boolean(raw.isVerified),
  };
}

export class NeonPropertyRepository implements IPropertyRepository {
  private readonly client: NeonClient;

  constructor(client: NeonClient = neonClient) {
    this.client = client;
  }

  async findAll(): Promise<Property[]> {
    const docs = await this.client.queryCollection<Property>(PROPERTIES_COLLECTION);
    return docs.map((d) => normalizePropertyRecord(d as unknown as Record<string, unknown>));
  }

  async findById(id: string): Promise<Property | null> {
    const trimmed = String(id || '').trim();
    if (!trimmed) return null;
    const doc = await this.client.getDocument<Property>(PROPERTIES_COLLECTION, trimmed);
    if (!doc) return null;
    return normalizePropertyRecord(doc as unknown as Record<string, unknown>);
  }

  async findWhere(filters: QueryFilter[]): Promise<Property[]> {
    const docs = await this.client.queryCollection<Property>(PROPERTIES_COLLECTION, filters);
    return docs.map((d) => normalizePropertyRecord(d as unknown as Record<string, unknown>));
  }

  async create(property: Omit<Property, 'id'>): Promise<Property> {
    if (!property || typeof property !== 'object') {
      throw new Error('Property payload is required.');
    }

    const payload: Record<string, unknown> = {
      ...property,
      publishDate: property.publishDate || new Date().toISOString(),
      isDemo: false,
      source: property.source || 'user',
    };
    delete payload.id;

    const created = await this.client.createDocument<Property>(PROPERTIES_COLLECTION, payload);
    return normalizePropertyRecord(created as unknown as Record<string, unknown>);
  }

  async update(id: string, patch: Partial<Property>): Promise<void> {
    const trimmed = String(id || '').trim();
    if (!trimmed) {
      throw new Error('Property ID is required for update.');
    }
    if (!patch || typeof patch !== 'object') {
      throw new Error('Update patch object is required.');
    }
    const safePatch: Record<string, unknown> = { ...patch };
    delete safePatch.id;
    await this.client.updateDocument(PROPERTIES_COLLECTION, trimmed, safePatch);
  }

  async delete(id: string): Promise<void> {
    const trimmed = String(id || '').trim();
    if (!trimmed) {
      throw new Error('Property ID is required for deletion.');
    }
    await this.client.deleteDocument(PROPERTIES_COLLECTION, trimmed);
  }

  async resetAllKeepUsers(): Promise<ResetPropertiesResult> {
    return this.client.resetPropertiesKeepUsers();
  }

  subscribeAll(callback: (properties: Property[]) => void, onError?: (err: Error) => void): () => void {
    return this.client.subscribeCollection<Property>(
      PROPERTIES_COLLECTION,
      undefined,
      (docs) => callback(docs.map((d) => normalizePropertyRecord(d as unknown as Record<string, unknown>))),
      onError
    );
  }
}

export const neonPropertyRepository = new NeonPropertyRepository(neonClient);
