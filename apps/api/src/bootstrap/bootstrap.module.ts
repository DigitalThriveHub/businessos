import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module';
import { DatabaseModule } from '../database/database.module';
import { BootstrapController } from './bootstrap.controller';
import { BootstrapService } from './bootstrap.service';

@Module({
  imports: [AuthModule, DatabaseModule],
  controllers: [BootstrapController],
  providers: [BootstrapService],
})
export class BootstrapModule {}