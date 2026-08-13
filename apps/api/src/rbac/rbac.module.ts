import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { RbacService } from './rbac.service';

@Module({
  imports: [DatabaseModule],
  providers: [RbacService],
  exports: [RbacService],
})
export class RbacModule {}