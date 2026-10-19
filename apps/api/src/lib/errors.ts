export class HttpError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
  }
}

export const notFound = (what = 'Item') => new HttpError(404, 'not_found', `${what} not found`);
export const badRequest = (message: string, details?: unknown) => new HttpError(400, 'bad_request', message, details);
export const conflict = (code: string, message: string, details?: unknown) => new HttpError(409, code, message, details);
