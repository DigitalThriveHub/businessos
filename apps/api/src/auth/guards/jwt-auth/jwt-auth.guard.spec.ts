import { ConfigService } from '@nestjs/config';
import { JwtAuthGuard } from './jwt-auth.guard';

describe('JwtAuthGuard', () => {
  it('should be defined', () => {
    const configService = new ConfigService({
      SUPABASE_JWT_SECRET: 'test-secret',
    });

    expect(new JwtAuthGuard(configService)).toBeDefined();
  });
});