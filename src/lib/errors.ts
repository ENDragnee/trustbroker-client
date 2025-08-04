export class InitializationError extends Error {
  public readonly status?: string;

  constructor(message: string, status?: string) {
    super(message);
    this.name = "InitializationError";
    this.status = status;
  }
}
export class AuthError extends Error {
    public readonly status?: string;
    constructor(message: string, status?: string) {
        super(message);
        this.name = "AuthError";
        this.status = status;
    }
}
export class RequestError extends Error {
    public readonly status?: string;
    constructor(message: string, status?: string) {
        super(message);
        this.name = "RequestError";
        this.status = status;
    }
}
export class SignatureError extends Error {
    public readonly status?: string;
    constructor(message: string, status?: string) {
        super(message);
        this.name = "SignatureError";
        this.status = status;
    }
}
