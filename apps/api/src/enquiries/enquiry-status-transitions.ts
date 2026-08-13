import { BadRequestException } from '@nestjs/common';
import { EnquiryStatus } from '../generated/prisma/enums';

const ALLOWED_TRANSITIONS: Readonly<
  Record<EnquiryStatus, readonly EnquiryStatus[]>
> = {
  [EnquiryStatus.NEW]: [
    EnquiryStatus.CONTACTED,
    EnquiryStatus.CLOSED,
    EnquiryStatus.SPAM,
  ],
  [EnquiryStatus.CONTACTED]: [
    EnquiryStatus.QUALIFIED,
    EnquiryStatus.CLOSED,
    EnquiryStatus.SPAM,
  ],
  [EnquiryStatus.QUALIFIED]: [
    EnquiryStatus.CONSULTATION_BOOKED,
    EnquiryStatus.CLOSED,
  ],
  [EnquiryStatus.CONSULTATION_BOOKED]: [
    EnquiryStatus.CONVERTED,
    EnquiryStatus.CLOSED,
  ],
  [EnquiryStatus.CONVERTED]: [],
  [EnquiryStatus.CLOSED]: [EnquiryStatus.CONTACTED],
  [EnquiryStatus.SPAM]: [EnquiryStatus.NEW],
};

export function assertValidEnquiryStatusTransition(
  currentStatus: EnquiryStatus,
  nextStatus: EnquiryStatus,
): void {
  if (currentStatus === nextStatus) {
    return;
  }

  if (!ALLOWED_TRANSITIONS[currentStatus].includes(nextStatus)) {
    throw new BadRequestException(
      `Enquiry status cannot change from ${currentStatus} to ${nextStatus}.`,
    );
  }
}
