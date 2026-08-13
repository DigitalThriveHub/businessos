import {
  Body,
  Controller,
  Delete,
  Get,
  Param,
  ParseUUIDPipe,
  Patch,
  Post,
  Query,
  Req,
  UseGuards,
} from '@nestjs/common';
import type { JWTPayload } from 'jose';
import { RequirePermissions } from '../auth/decorators/require-permissions.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { EnquiryQueryDto } from './dto/enquiry-query.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import { EnquiriesService } from './enquiries.service';
import { enquiryContextFromJwt } from './enquiry-context';

interface AuthenticatedRequest {
  user?: JWTPayload;
}

@Controller('enquiries')
@UseGuards(JwtAuthGuard, OrganisationAccessGuard, PermissionGuard)
export class EnquiriesController {
  constructor(private readonly enquiriesService: EnquiriesService) {}

  @Post()
  @RequirePermissions('enquiries.create')
  create(@Body() dto: CreateEnquiryDto, @Req() request: AuthenticatedRequest) {
    return this.enquiriesService.create(
      dto,
      enquiryContextFromJwt(request.user, dto.organisationId),
    );
  }

  @Get()
  @RequirePermissions('enquiries.read')
  findAll(
    @Query() query: EnquiryQueryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.enquiriesService.findAll(
      query,
      enquiryContextFromJwt(request.user, query.organisationId),
    );
  }

  @Get(':id')
  @RequirePermissions('enquiries.read')
  findOne(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organisationId', ParseUUIDPipe) organisationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.enquiriesService.findOne(
      id,
      enquiryContextFromJwt(request.user, organisationId),
    );
  }

  @Patch(':id')
  @RequirePermissions('enquiries.update')
  update(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organisationId', ParseUUIDPipe) organisationId: string,
    @Body() dto: UpdateEnquiryDto,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.enquiriesService.update(
      id,
      dto,
      enquiryContextFromJwt(request.user, organisationId),
    );
  }

  @Delete(':id')
  @RequirePermissions('enquiries.delete')
  remove(
    @Param('id', ParseUUIDPipe) id: string,
    @Query('organisationId', ParseUUIDPipe) organisationId: string,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.enquiriesService.remove(
      id,
      enquiryContextFromJwt(request.user, organisationId),
    );
  }
}
