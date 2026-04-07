export type DocumentUri = string & { readonly __brand: 'DocumentUri' };

const UNRESERVED = /^[A-Za-z0-9\-._~]$/;

export function normalizeUri(raw: string): DocumentUri {
  const schemeEnd = raw.indexOf('://');
  if (schemeEnd === -1) {
    return raw.replace(/\/+$/, '') as DocumentUri;
  }

  const scheme = raw.substring(0, schemeEnd).toLowerCase();
  const rest = raw.substring(schemeEnd + 3);

  const pathStart = rest.indexOf('/');
  const authority = pathStart === -1 ? rest : rest.substring(0, pathStart);
  const path = pathStart === -1 ? '' : rest.substring(pathStart);

  const decodedPath = path.replace(/%([0-9A-Fa-f]{2})/g, (match, hex) => {
    const char = String.fromCharCode(parseInt(hex, 16));
    return UNRESERVED.test(char) ? char : match;
  });

  const trimmedPath = decodedPath.length > 1 ? decodedPath.replace(/\/+$/, '') : decodedPath;

  return `${scheme}://${authority.toLowerCase()}${trimmedPath}` as DocumentUri;
}

export class UriMap<V> {
  private map = new Map<string, V>();

  set(uri: DocumentUri, value: V): void { this.map.set(uri, value); }
  get(uri: DocumentUri): V | undefined { return this.map.get(uri); }
  has(uri: DocumentUri): boolean { return this.map.has(uri); }
  delete(uri: DocumentUri): boolean { return this.map.delete(uri); }
  get size(): number { return this.map.size; }
  clear(): void { this.map.clear(); }
  keys(): IterableIterator<DocumentUri> { return this.map.keys() as IterableIterator<DocumentUri>; }
  values(): IterableIterator<V> { return this.map.values(); }
  entries(): IterableIterator<[DocumentUri, V]> { return this.map.entries() as IterableIterator<[DocumentUri, V]>; }
  forEach(fn: (value: V, key: DocumentUri) => void): void { this.map.forEach(fn as any); }
}

export class UriSet {
  private set = new Set<string>();

  add(uri: DocumentUri): void { this.set.add(uri); }
  has(uri: DocumentUri): boolean { return this.set.has(uri); }
  delete(uri: DocumentUri): boolean { return this.set.delete(uri); }
  get size(): number { return this.set.size; }
  clear(): void { this.set.clear(); }
}
