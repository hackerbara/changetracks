// packages/core/src/host/decorations/author-colors.ts
import { AUTHOR_PALETTE } from './styles.js';

export class AuthorColorMap {
  private map = new Map<string, number>();

  getIndex(author: string): number {
    if (!this.map.has(author)) {
      this.map.set(author, this.map.size % AUTHOR_PALETTE.length);
    }
    return this.map.get(author)!;
  }

  getColor(author: string): { light: string; dark: string } {
    return AUTHOR_PALETTE[this.getIndex(author)];
  }
}
