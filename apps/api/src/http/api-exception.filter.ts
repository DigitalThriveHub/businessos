import {
  ArgumentsHost,
  Catch,
  HttpException,
  HttpStatus,
  Logger,
  type ExceptionFilter,
} from '@nestjs/common';
import type { Response } from 'express';

import type { CorrelatedRequest } from './correlation-id.middleware';

type ExceptionBody = {
  message?: string | string[];
  error?: string;
  code?: string;
};

const titles: Record<number, string> = {
  400: 'Invalid request',
  401: 'Authentication required',
  403: 'Operation not permitted',
  404: 'Record not found',
  409: 'Operation conflict',
  413: 'Request too large',
  429: 'Too many requests',
  500: 'Internal service error',
  503: 'Service temporarily unavailable',
};

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<CorrelatedRequest>();
    const response = http.getResponse<Response>();
    const status =
      exception instanceof HttpException
        ? exception.getStatus()
        : HttpStatus.INTERNAL_SERVER_ERROR;
    const body =
      exception instanceof HttpException ? exception.getResponse() : undefined;
    const details = this.details(body, status);
    const correlationId = request.correlationId;

    if (status >= 500) {
      this.logger.error(
        `API request failed; method=${request.method}; path=${request.path}; status=${status}; correlationId=${correlationId}; errorType=${
          exception instanceof Error ? exception.name : 'unknown'
        }`,
      );
    }

    response
      .status(status)
      .type('application/problem+json')
      .setHeader('Cache-Control', 'no-store')
      .setHeader('X-Content-Type-Options', 'nosniff')
      .json({
        type: `/problems/${details.code}`,
        title: titles[status] ?? 'Request failed',
        status,
        detail: details.detail,
        code: details.code,
        correlationId,
        timestamp: new Date().toISOString(),
        instance: request.path,
      });
  }

  private details(
    responseBody: string | object | undefined,
    status: number,
  ): { detail: string; code: string } {
    const fallback =
      status >= 500
        ? 'The service could not complete the request. Retry safely or give support the correlation ID.'
        : (titles[status] ?? 'The request could not be completed.');
    if (typeof responseBody === 'string') {
      return {
        detail: status >= 500 ? fallback : responseBody,
        code: this.code(status),
      };
    }
    const body = (responseBody ?? {}) as ExceptionBody;
    const message = Array.isArray(body.message)
      ? body.message.join(' ')
      : body.message;
    return {
      detail: status >= 500 ? fallback : (message ?? fallback),
      code:
        body.code?.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 80) ||
        this.code(status),
    };
  }

  private code(status: number): string {
    const codes: Record<number, string> = {
      400: 'validation_failed',
      401: 'authentication_required',
      403: 'permission_denied',
      404: 'record_not_found',
      409: 'operation_conflict',
      413: 'request_too_large',
      429: 'rate_limited',
      503: 'provider_unavailable',
    };
    return codes[status] ?? 'internal_error';
  }
}
