import {
  Controller,
  Get,
  UseGuards,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';

@Controller('auth')
export class AuthController {
  constructor(private readonly authService: AuthService) {}

  @Get('me')
  @UseGuards(JwtAuthGuard)
  getCurrentUser(@CurrentUser() user: JWTPayload) {
    return this.authService.getCurrentUser(user);
  }
}