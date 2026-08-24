/**
 * Thrown by controllers/services for any expected failure. The error
 * middleware maps this to a clean `{ message }` JSON response and never
 * leaks stack traces or internal details to the client (spec §33/§53).
 */
export class ApiError extends Error {
  constructor(public readonly status: number, message: string, public readonly details?: unknown) {
    super(message);
    this.name = 'ApiError';
  }

  static badRequest(message: string, details?: unknown) { return new ApiError(400, message, details); }
  static unauthorized(message = 'Unauthorized') { return new ApiError(401, message); }
  static forbidden(message = 'Forbidden') { return new ApiError(403, message); }
  static notFound(message = 'Not found') { return new ApiError(404, message); }
  static conflict(message: string) { return new ApiError(409, message); }
  static unprocessable(message: string, details?: unknown) { return new ApiError(422, message, details); }
  static tooMany(message = 'Too many requests') { return new ApiError(429, message); }
  static internal(message = 'Internal server error') { return new ApiError(500, message); }
}
