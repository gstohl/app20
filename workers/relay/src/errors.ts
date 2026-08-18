export class RelayHttpError extends Error {
  readonly status: number;

  constructor(status: number, message: string) {
    super(message);
    this.name = "RelayHttpError";
    this.status = status;
  }
}

export function errorResponse(error: unknown): Response {
  const known = error instanceof RelayHttpError;
  return Response.json(
    { error: known ? error.message : "Relay unavailable." },
    {
      status: known ? error.status : 502,
      headers: {
        "cache-control": "no-store",
        "content-type": "application/json; charset=utf-8",
      },
    },
  );
}
