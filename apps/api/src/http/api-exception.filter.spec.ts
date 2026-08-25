import {
  BadRequestException,
  Logger,
  type ArgumentsHost,
} from '@nestjs/common';

import { ApiExceptionFilter } from './api-exception.filter';

function harness() {
  const json = jest.fn();
  const response = {
    status: jest.fn().mockReturnThis(),
    type: jest.fn().mockReturnThis(),
    setHeader: jest.fn().mockReturnThis(),
    json,
  };
  const request = {
    method: 'POST',
    path: '/api/v1/communications',
    correlationId: 'request-12345678',
  };
  const host = {
    switchToHttp: () => ({
      getRequest: () => request,
      getResponse: () => response,
    }),
  } as unknown as ArgumentsHost;
  return { host, response, json };
}

describe('ApiExceptionFilter', () => {
  beforeEach(() => jest.spyOn(Logger.prototype, 'error').mockImplementation());
  afterEach(() => jest.restoreAllMocks());

  it('returns a stable problem document without exposing internal errors', () => {
    const { host, response, json } = harness();
    new ApiExceptionFilter().catch(
      new Error('database password and provider response body'),
      host,
    );

    expect(response.status).toHaveBeenCalledWith(500);
    expect(response.type).toHaveBeenCalledWith('application/problem+json');
    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 500,
        code: 'internal_error',
        correlationId: 'request-12345678',
      }),
    );
    expect(JSON.stringify(json.mock.calls[0]?.[0])).not.toContain('password');
  });

  it('preserves a safe validation code and user-correctable detail', () => {
    const { host, json } = harness();
    new ApiExceptionFilter().catch(
      new BadRequestException({
        message: ['Recipient is invalid.', 'Refresh and retry.'],
        code: 'gate_l_invalid_recipient',
      }),
      host,
    );

    expect(json).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 400,
        code: 'gate_l_invalid_recipient',
        detail: 'Recipient is invalid. Refresh and retry.',
      }),
    );
  });
});
