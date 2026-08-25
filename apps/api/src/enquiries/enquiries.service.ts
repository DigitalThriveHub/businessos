import { Injectable, NotFoundException } from '@nestjs/common';
import { RlsTransactionService } from '../database/rls-transaction.service';
import { Prisma } from '../generated/prisma/client';
import { EnquiryStatus } from '../generated/prisma/enums';
import { CreateEnquiryDto } from './dto/create-enquiry.dto';
import { EnquiryQueryDto } from './dto/enquiry-query.dto';
import { UpdateEnquiryDto } from './dto/update-enquiry.dto';
import type { EnquiryRequestContext } from './enquiry-context';
import { assertValidEnquiryTransition } from './enquiry-workflow';

@Injectable()
export class EnquiriesService {
  constructor(private readonly rls: RlsTransactionService) {}

  async create(dto: CreateEnquiryDto, context: EnquiryRequestContext) {
    const data: Prisma.EnquiryUncheckedCreateInput = {
      organisationId: context.organisationId,
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
      createdByUserId: context.userId,
      updatedByUserId: context.userId,
    };

    return this.rls.run(context, (transaction) =>
      transaction.enquiry.create({ data }),
    );
  }

  async findAll(query: EnquiryQueryDto, context: EnquiryRequestContext) {
    const page = query.page ?? 1;
    const limit = query.limit ?? 20;
    const skip = (page - 1) * limit;
    const search = query.search?.trim();

    const where: Prisma.EnquiryWhereInput = {
      organisationId: context.organisationId,
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

    const [items, total] = await this.rls.run(context, (transaction) =>
      Promise.all([
        transaction.enquiry.findMany({
          where,
          skip,
          take: limit,
          orderBy: {
            createdAt: 'desc',
          },
        }),
        transaction.enquiry.count({ where }),
      ]),
    );

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

  async findOne(id: string, context: EnquiryRequestContext) {
    return this.rls.run(context, (transaction) =>
      this.findOneWithClient(transaction, id, context.organisationId),
    );
  }

  private async findOneWithClient(
    transaction: Prisma.TransactionClient,
    id: string,
    organisationId: string,
  ) {
    const enquiry = await transaction.enquiry.findFirst({
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
    dto: UpdateEnquiryDto,
    context: EnquiryRequestContext,
  ) {
    return this.rls.run(context, async (transaction) => {
      const current = await this.findOneWithClient(
        transaction,
        id,
        context.organisationId,
      );

      assertValidEnquiryTransition(current.status, dto.status);

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
        updatedByUserId: context.userId,
        ...(dto.status === EnquiryStatus.CONVERTED
          ? {
              convertedAt: new Date(),
            }
          : {}),
      };

      return transaction.enquiry.update({
        where: {
          id,
        },
        data,
      });
    });
  }

  async remove(id: string, context: EnquiryRequestContext) {
    return this.rls.run(context, async (transaction) => {
      const [result] = await transaction.$queryRaw<Array<{ deleted: boolean }>>`
        SELECT private.soft_delete_enquiry(
          ${id}::uuid,
          ${context.organisationId}::uuid
        ) AS deleted
      `;

      if (result?.deleted !== true) {
        throw new NotFoundException('Enquiry not found');
      }

      return {
        message: 'Enquiry deleted successfully',
      };
    });
  }
}
