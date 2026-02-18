export class AppError extends Error {
  readonly code: string;
  constructor(code: string, message: string) {
    super(message);
    this.code = code;
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "Unauthorized") {
    super("UNAUTHORIZED", message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Not found") {
    super("NOT_FOUND", message);
  }
}

export class ValidationError extends AppError {
  constructor(message = "Invalid input") {
    super("VALIDATION", message);
  }
}

export class MarketClosedError extends AppError {
  constructor(message = "Market is not open") {
    super("MARKET_CLOSED", message);
  }
}

export class InsufficientFundsError extends AppError {
  constructor(message = "Insufficient funds") {
    super("INSUFFICIENT_FUNDS", message);
  }
}

export class BonusCooldownError extends AppError {
  constructor(message = "Bonus cooldown active") {
    super("BONUS_COOLDOWN", message);
  }
}

export class InvalidMarketTypeError extends AppError {
  constructor(message = "Invalid market type") {
    super("INVALID_MARKET_TYPE", message);
  }
}
