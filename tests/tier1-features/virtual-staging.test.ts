import { describe, it, expect } from 'vitest';
import {
  createVirtualStagedObject,
  addVirtualStagedObject,
  removeVirtualStagedObject,
  updateVirtualStagedObject,
  getStagedObjectsForRoom,
  isObjectWithinPropertyBounds,
} from '../../src/services/3d/virtual-staging-service';
import { ThreeDTour } from '../../src/types/three-d-tour';

describe('HETTETY 3D — Virtual Staging Service', () => {
  const baseTour: ThreeDTour = {
    status: 'ready',
    assetUrl: 'https://cdn.hettety.com/properties/prop_123/tour/scene.spz',
    format: 'spz',
    isCalibratedMetric: true,
    bounds: {
      min: [-5.0, -4.0, 0.0],
      max: [5.0, 4.0, 3.0],
    },
    rooms: [
      { id: 'room_reception', name: 'Reception', type: 'living_room' },
      { id: 'room_master', name: 'Master Bedroom', type: 'bedroom' },
    ],
  };

  it('creates a valid virtual staged object with default rotation and scale', () => {
    const sofa = createVirtualStagedObject({
      name: 'Modern Velvet Sofa',
      nameAr: 'كنبة مخملية مودرن',
      category: 'seating',
      glbUrl: 'https://cdn.hettety.com/assets/furniture/sofa_modern.glb',
      sourceImageUrl: 'https://cdn.hettety.com/uploads/sofa_catalog.jpg',
      roomId: 'room_reception',
      position: [1.2, -0.5, 0.0],
    });

    expect(sofa.id).toMatch(/^stage_/);
    expect(sofa.name).toBe('Modern Velvet Sofa');
    expect(sofa.category).toBe('seating');
    expect(sofa.position).toEqual([1.2, -0.5, 0.0]);
    expect(sofa.rotation).toEqual([0, 0, 0]);
    expect(sofa.scale).toEqual([1, 1, 1]);
    expect(sofa.isAnchored).toBe(true);
  });

  it('rejects invalid staging parameters fail-closed', () => {
    // Empty name
    expect(() =>
      createVirtualStagedObject({
        name: '   ',
        category: 'table',
        glbUrl: 'https://cdn.hettety.com/table.glb',
        position: [0, 0, 0],
      })
    ).toThrow('STAGING_INVALID_NAME');

    // Invalid GLB URL
    expect(() =>
      createVirtualStagedObject({
        name: 'Dining Table',
        category: 'table',
        glbUrl: 'javascript:alert(1)',
        position: [0, 0, 0],
      })
    ).toThrow('STAGING_INVALID_GLB_URL');

    // Non-finite position coordinates
    expect(() =>
      createVirtualStagedObject({
        name: 'Dining Table',
        category: 'table',
        glbUrl: 'https://cdn.hettety.com/table.glb',
        position: [0, NaN, 0],
      })
    ).toThrow('STAGING_INVALID_COORDINATES');
  });

  it('immutably adds and updates virtual staged objects in the tour', () => {
    const chair = createVirtualStagedObject({
      name: 'Nordic Armchair',
      category: 'seating',
      glbUrl: 'https://cdn.hettety.com/chair.glb',
      roomId: 'room_reception',
      position: [2.0, 1.0, 0.0],
    });

    const tourWithChair = addVirtualStagedObject(baseTour, chair);
    expect(tourWithChair.virtualStagedObjects).toHaveLength(1);
    expect(baseTour.virtualStagedObjects).toBeUndefined(); // Immutable

    // Update position and rotation
    const updatedTour = updateVirtualStagedObject(tourWithChair, chair.id, {
      position: [2.5, 1.2, 0.0],
      rotation: [0, 1.57, 0],
    });

    const updatedChair = updatedTour.virtualStagedObjects?.find((o) => o.id === chair.id);
    expect(updatedChair?.position).toEqual([2.5, 1.2, 0.0]);
    expect(updatedChair?.rotation).toEqual([0, 1.57, 0]);
  });

  it('filters staged objects by room', () => {
    const sofa = createVirtualStagedObject({
      name: 'Sofa',
      category: 'seating',
      glbUrl: 'https://cdn.hettety.com/sofa.glb',
      roomId: 'room_reception',
      position: [0, 0, 0],
    });
    const bed = createVirtualStagedObject({
      name: 'Bed',
      category: 'bed',
      glbUrl: 'https://cdn.hettety.com/bed.glb',
      roomId: 'room_master',
      position: [0, 0, 0],
    });

    let tour = addVirtualStagedObject(baseTour, sofa);
    tour = addVirtualStagedObject(tour, bed);

    const receptionItems = getStagedObjectsForRoom(tour, 'room_reception');
    const masterItems = getStagedObjectsForRoom(tour, 'room_master');

    expect(receptionItems).toHaveLength(1);
    expect(receptionItems[0].name).toBe('Sofa');
    expect(masterItems).toHaveLength(1);
    expect(masterItems[0].name).toBe('Bed');
  });

  it('removes staged objects immutably', () => {
    const table = createVirtualStagedObject({
      name: 'Table',
      category: 'table',
      glbUrl: 'https://cdn.hettety.com/table.glb',
      position: [0, 0, 0],
    });

    const tourWithTable = addVirtualStagedObject(baseTour, table);
    expect(tourWithTable.virtualStagedObjects).toHaveLength(1);

    const cleanedTour = removeVirtualStagedObject(tourWithTable, table.id);
    expect(cleanedTour.virtualStagedObjects).toHaveLength(0);
  });

  it('verifies spatial boundary containment with tolerance', () => {
    // Inside bounds
    expect(isObjectWithinPropertyBounds([0, 0, 1.5], baseTour.bounds)).toBe(true);

    // At edge within 0.5m tolerance
    expect(isObjectWithinPropertyBounds([5.3, 0, 1.5], baseTour.bounds)).toBe(true);

    // Completely outside
    expect(isObjectWithinPropertyBounds([15.0, 0, 1.5], baseTour.bounds)).toBe(false);
    expect(isObjectWithinPropertyBounds([0, -10.0, 1.5], baseTour.bounds)).toBe(false);
  });
});
