import { describe, expect, it } from 'vitest';
import { BLOCKS } from '../src/core/blocks';
import { BLOCK_MODELS } from '../src/render/blockModels';

describe('render registry', () => {
  it('has a model for every block type', () => {
    for (const b of BLOCKS) expect(BLOCK_MODELS[b.id], b.id).toBeTypeOf('function');
  });
});
