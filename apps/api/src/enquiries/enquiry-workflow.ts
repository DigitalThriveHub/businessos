import { BadRequestException } from '@nestjs/common';
import { EnquiryStatus } from '../generated/prisma/enums';

const ALLOWED_TRANSITIONS: Readonly<
  Record<EnquiryStatus, readonly EnquiryStatus[]>
> = {
  NEW: ['CONTACTED', 'SPAM', 'CLOSED'],
  CONTACTED: ['QUALIFIED', 'CLOSED', 'SPAM'],
  QUALIFIED: ['CONSULTATION_BOOKED', 'CLOSED'],
  CONSULTATION_BOOKED: ['CONVERTED', 'CLOSED'],
  CONVERTED: [],
  CLOSED: ['CONTACTED'],
  SPAM: ['NEW'],
};

export function assertValidEnquiryTransition(
  current: EnquiryStatus,
  next?: EnquiryStatus,
): void {
  if (!next || next === current) {
    return;
  }

  if (!ALLOWED_TRANSITIONS[current].includes(next)) {
    throw new BadRequestException(
      `Enquiry status cannot change from ${current} to ${next}`,
    );
  }
}
