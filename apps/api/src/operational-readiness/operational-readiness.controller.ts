import {
  Controller,
  Get,
  Header,
  ServiceUnavailableException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../database/prisma.service';

@Controller('health')
export class OperationalReadinessController {
  constructor(
    private readonly database: PrismaService,
    private readonly config: ConfigService,
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
}
