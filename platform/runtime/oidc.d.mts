import type { IncomingMessage, ServerResponse } from 'node:http';
export function encryptionKey(value?: string): Buffer;
export function encrypt(value: unknown, key?: Buffer): string;
export function decrypt<T = unknown>(value: string, key?: Buffer): T;
export function validateClient(
  name: unknown,
  uris: unknown
): { name: string; redirectUris: string[] };
export function oidcMiddleware(
  req: IncomingMessage,
  res: ServerResponse,
  next: () => void
): Promise<void>;
