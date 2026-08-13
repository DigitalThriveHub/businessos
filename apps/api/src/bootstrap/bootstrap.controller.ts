import {
  Body,
  Controller,
  Post,
  UnauthorizedException,
  UseGuards,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';

import { CurrentUser } from '../auth/decorators/current-user/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { BootstrapService } from './bootstrap.service';
import { BootstrapOrganisationDto } from './dto/bootstrap-organisation.dto';
import type { BootstrapOrganisationResult } from './bootstrap.types';

@Controller('bootstrap')
@UseGuards(JwtAuthGuard)
export class BootstrapController {
  constructor(
    private readonly bootstrapService: BootstrapService,
  ) {}

  @Post('organisation')
  async bootstrapOrganisation(
    @CurrentUser() user: JWTPayload,
    @Body() dto: BootstrapOrganisationDto,
  ): Promise<BootstrapOrganisationResult> {
    const userId = user.sub;
    const email = this.extractEmail(user);

    if (!userId || !email) {
      throw new UnauthorizedException(
        'Authenticated user identity is incomplete.',
      );
    }

    return this.bootstrapService.bootstrapOrganisation(
      {
        userId,
        email,
      },
      dto,
    );
  }

  private extractEmail(user: JWTPayload): string | null {
    const email = user.email;

    return typeof email === 'string' && email.trim()
      ? email.trim().toLowerCase()
      : null;
  }
}