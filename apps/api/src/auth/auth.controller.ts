import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import type {
  VerifiedUserJwtPayload,
} from './verified-jwt-payload';

@Controller('auth')
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.authService.getCurrentUser(user);
  }
}