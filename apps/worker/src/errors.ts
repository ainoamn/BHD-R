export class PermanentJobError extends Error {
  override readonly name = 'PermanentJobError';

  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

export function safeErrorCode(error: unknown): string {
  if (error instanceof PermanentJobError) return error.code;
  if (error instanceof Error && error.name) return error.name.toUpperCase();
  return 'UNKNOWN_ERROR';
}
