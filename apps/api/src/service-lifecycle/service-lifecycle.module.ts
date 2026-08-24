import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { ServiceLifecycleController } from './service-lifecycle.controller';
import { ServiceLifecycleService } from './service-lifecycle.service';

@Module({
  imports: [DatabaseModule],
  controllers: [ServiceLifecycleController],
  providers: [ServiceLifecycleService],
})
export class ServiceLifecycleModule {}
