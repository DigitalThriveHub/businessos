import { ServiceUnavailableException } from '@nestjs/common';
import { OperationalReadinessController } from './operational-readiness.controller';

describe('OperationalReadinessController', () => {
  const config = { get: jest.fn().mockReturnValue('abcdef123456') };
  const readiness = {
    authorise: jest.fn(),
    diagnostics: jest.fn().mockResolvedValue({ status: 'operational' }),
  };

  it('reports liveness without touching dependencies', () => {
    const database = { $queryRaw: jest.fn() };
    const controller = new OperationalReadinessController(
      database as never,
      config as never,
      readiness as never,
    );
    expect(controller.live()).toEqual({ status: 'ok' });
    expect(database.$queryRaw).not.toHaveBeenCalled();
  });

  it('reports readiness only after the database answers', async () => {
    const database = {
      $queryRaw: jest.fn().mockResolvedValue([{ '?column?': 1 }]),
    };
    const controller = new OperationalReadinessController(
      database as never,
      config as never,
      readiness as never,
    );
    await expect(controller.ready()).resolves.toEqual({
      status: 'ready',
      release: 'abcdef123456',
    });
  });

  it('fails closed when the database is unavailable', async () => {
    const database = {
      $queryRaw: jest.fn().mockRejectedValue(new Error('down')),
    };
    const controller = new OperationalReadinessController(
      database as never,
      config as never,
      readiness as never,
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });

  it('protects detailed operational diagnostics with a separate token', async () => {
    const controller = new OperationalReadinessController(
      { $queryRaw: jest.fn() } as never,
      config as never,
      readiness as never,
    );
    await expect(controller.diagnostics('operations-token')).resolves.toEqual({
      status: 'operational',
    });
    expect(readiness.authorise).toHaveBeenCalledWith('operations-token');
  });
});
