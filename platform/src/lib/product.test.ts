import { describe, expect, it } from 'vitest';

import { product } from './product';

describe('product metadata', () => {
  it('identifies the application', () => {
    expect(product.name).toBe('Cluster Manager');
  });
});
