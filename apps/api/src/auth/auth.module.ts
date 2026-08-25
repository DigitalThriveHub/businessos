import { Module } from '@nestjs/common';
import { DatabaseModule } from '../database/database.module';
import { AuthController } from './auth.controller';
import { AuthService } from './auth.service';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import { PermissionGuard } from './guards/permission/permission.guard';

@Module({
  imports: [DatabaseModule],
  controllers: [AuthController],
  providers: [AuthService, JwtAuthGuard, PermissionGuard],
  exports: [AuthService, JwtAuthGuard, PermissionGuard],
})
export class AuthModule {}
