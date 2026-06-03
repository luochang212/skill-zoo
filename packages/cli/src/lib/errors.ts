export class CliError extends Error {
  readonly exitCode: number;

  constructor(message: string, exitCode = 1) {
    super(message);
    this.name = "CliError";
    this.exitCode = exitCode;
  }
}

export function messageFromError(error: unknown): string {
  if (error instanceof Error) {
    return error.message;
  }

  return String(error);
}
