import {
  applyDecorators,
  Body,
  Controller,
  Get,
  Header,
  HttpCode,
  HttpStatus,
  Param,
  ParseUUIDPipe,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';

import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import {
  type OrganisationScopedRequest,
  requireOrganisationAccessContext,
} from '../auth/request-security-context';
import { GetMyAiWorkspaceDto, RunMyAiCommandDto } from './dto/my-ai.dto';
import { MyAiService } from './my-ai.service';

function SecureResponse() {
  return applyDecorators(
    Header('Cache-Control', 'no-store, private'),
    Header('Pragma', 'no-cache'),
    Header('Referrer-Policy', 'no-referrer'),
    Header('X-Content-Type-Options', 'nosniff'),
  );
}

@Controller('organisations/:organisationId/my-ai')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class MyAiController {
  constructor(private readonly myAiService: MyAiService) {}

  @Get()
  @SecureResponse()
  @RequirePermissions('ai.workspace.access')
  getWorkspace(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Query() query: GetMyAiWorkspaceDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.myAiService.getWorkspace(
      query.conversationId,
      requireOrganisationAccessContext(request),
    );
  }

  @Post('commands')
  @HttpCode(HttpStatus.CREATED)
  @SecureResponse()
  @RequirePermissions('ai.workspace.access')
  runCommand(
    @Param('organisationId', new ParseUUIDPipe({ version: '4' }))
    _organisationId: string,
    @Body() dto: RunMyAiCommandDto,
    @Req() request: OrganisationScopedRequest,
  ) {
    return this.myAiService.runCommand(
      dto,
      requireOrganisationAccessContext(request),
    );
  }
}
