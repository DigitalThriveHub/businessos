import {
  Controller,
  ForbiddenException,
  Get,
  Header,
  Headers,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';
import { OperationalReadinessService } from './operational-readiness.service';

@Controller('health')
export class OperationalReadinessController {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService,
    private readonly readiness: OperationalReadinessService,
  ) {}

  @Get('live')
  @Header('Cache-Control', 'no-store')
  live() {
    return { status: 'ok' as const };
  }

  @Get('ready')
  @Header('Cache-Control', 'no-store')
  async ready() {
    try {
      await this.database.$queryRaw`SELECT 1`;
      return {
        status: 'ready' as const,
        release: this.config.get<string>('RELEASE_SHA', 'development'),
      };
    } catch {
      throw new ServiceUnavailableException({ status: 'not_ready' });
    }
  }

  @Get('diagnostics')
  @Header('Cache-Control', 'no-store')
  async diagnostics(@Headers('x-operations-token') token?: string) {
    try {
      this.readiness.authorise(token);
    } catch {
      throw new ForbiddenException({ status: 'forbidden' });
    }
    return this.readiness.diagnostics();
  }
}
