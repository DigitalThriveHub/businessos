import { ServiceUnavailableException } from '@nestjs/common';
import { OperationalReadinessController } from './operational-readiness.controller';

describe('OperationalReadinessController', () => {
  const config = { get: jest.fn().mockReturnValue('abcdef123456') };

  it('reports liveness without touching dependencies', () => {
    const database = { $queryRaw: jest.fn() };
    const controller = new OperationalReadinessController(
      database as never,
      config as never,
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
    );
    await expect(controller.ready()).rejects.toBeInstanceOf(
      ServiceUnavailableException,
    );
  });
});
