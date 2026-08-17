import {
  Body,
  Controller,
  Get,
  Patch,
  UseGuards,
} from '@nestjs/common';
import { AuthService } from './auth.service';
import { CurrentUser } from './decorators/current-user/current-user.decorator';
import { UpdateCurrentUserProfileDto } from './dto/update-current-user-profile.dto';
import { JwtAuthGuard } from './guards/jwt-auth/jwt-auth.guard';
import type {
  VerifiedUserJwtPayload,
} from './verified-jwt-payload';

@Controller('auth')
@UseGuards(JwtAuthGuard)
export class AuthController {
  constructor(
    private readonly authService: AuthService,
  ) {}

  @Get('me')
  getCurrentUser(
    @CurrentUser() user: VerifiedUserJwtPayload,
  ) {
    return this.authService.getCurrentUser(user);
  }

  @Patch('me')
  updateCurrentUserProfile(
    @CurrentUser() user: VerifiedUserJwtPayload,
    @Body() dto: UpdateCurrentUserProfileDto,
  ) {
    return this.authService.updateCurrentUserProfile(
      user,
      dto,
    );
  }
}