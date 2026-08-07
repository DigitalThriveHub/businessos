import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service';
import { Prisma } from '../generated/prisma/client';
import { EnquiryStatus } from '../generated/prisma/enums';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { EnquiryQueryDto } from './dto/enquiry-query.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';

@Injectable()
export class EnquiriesService {
  constructor(private readonly prisma: PrismaService) {}

  async create(dto: CreateEnquiryDto, actorUserId?: string) {
    const data: Prisma.EnquiryUncheckedCreateInput = {
      organisationId: dto.organisationId,
      assignedToUserId: dto.assignedToUserId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email?.trim().toLowerCase(),
      phone: dto.phone,
      country: dto.country,
      serviceType: dto.serviceType,
      message: dto.message,
      source: dto.source,
      status: dto.status,
      priority: dto.priority,
      nextFollowUpAt: dto.nextFollowUpAt
        ? new Date(dto.nextFollowUpAt)
        : undefined,
      createdByUserId: actorUserId,
      updatedByUserId: actorUserId,
    };

    return this.prisma.enquiry.create({ data });
  }

  async findAll(query: EnquiryQueryDto) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.EnquiryWhereInput = {
      organisationId: query.organisationId,
      deletedAt: null,
      status: query.status,
      priority: query.priority,
      assignedToUserId: query.assignedToUserId,
      ...(search
        ? {
            OR: [
              {
                firstName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                lastName: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                email: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                phone: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
              {
                serviceType: {
                  contains: search,
                  mode: 'insensitive',
                },
              },
            ],
          }
        : {}),
    };

    const [items, total] = await this.prisma.$transaction([
      this.prisma.enquiry.findMany({
        where,
        skip,
        take: limit,
        orderBy: {
          createdAt: 'desc',
        },
      }),
      this.prisma.enquiry.count({ where }),
    ]);

    return {
      items,
      pagination: {
        page,
        limit,
        total,
        totalPages: Math.ceil(total / limit),
      },
    };
  }

  async findOne(id: string, organisationId: string) {
    const enquiry = await this.prisma.enquiry.findFirst({
      where: {
        id,
        organisationId,
        deletedAt: null,
      },
    });

    if (!enquiry) {
      throw new NotFoundException('Enquiry not found');
    }

    return enquiry;
  }

  async update(
    id: string,
    organisationId: string,
    dto: UpdateEnquiryDto,
    actorUserId?: string,
  ) {
    await this.findOne(id, organisationId);

    const data: Prisma.EnquiryUncheckedUpdateInput = {
      assignedToUserId: dto.assignedToUserId,
      firstName: dto.firstName,
      lastName: dto.lastName,
      email: dto.email?.trim().toLowerCase(),
      phone: dto.phone,
      country: dto.country,
      serviceType: dto.serviceType,
      message: dto.message,
      source: dto.source,
      status: dto.status,
      priority: dto.priority,
      nextFollowUpAt: dto.nextFollowUpAt
        ? new Date(dto.nextFollowUpAt)
        : undefined,
      lastContactedAt: dto.lastContactedAt
        ? new Date(dto.lastContactedAt)
        : undefined,
      updatedByUserId: actorUserId,
      ...(dto.status === EnquiryStatus.CONVERTED
        ? { convertedAt: new Date() }
        : {}),
    };

    return this.prisma.enquiry.update({
      where: { id },
      data,
    });
  }

  async remove(
    id: string,
    organisationId: string,
    actorUserId?: string,
  ) {
    await this.findOne(id, organisationId);

    await this.prisma.enquiry.update({
      where: { id },
      data: {
        deletedAt: new Date(),
        updatedByUserId: actorUserId,
      },
    });

    return {
      message: 'Enquiry deleted successfully',
    };
  }
}