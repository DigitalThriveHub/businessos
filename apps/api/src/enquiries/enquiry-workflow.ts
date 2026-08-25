import { BadRequestException } from '@nestjs/common';
import { EnquiryStatus } from '../generated/prisma/enums';

const ALLOWED_TRANSITIONS: Readonly<
  Record<EnquiryStatus, readonly EnquiryStatus[]>
> = {
  NEW: ['CONTACTED', 'SPAM', 'CLOSED'],
  CONTACTED: ['QUALIFIED', 'CLOSED', 'SPAM'],
  QUALIFIED: ['CONSULTATION_BOOKED', 'CLOSED'],
  // Conversion is deliberately excluded. It is an atomic client-and-matter
  // provisioning operation, not an ordinary enquiry field update.
  CONSULTATION_BOOKED: ['CLOSED'],
  CONVERTED: [],
  CLOSED: ['CONTACTED'],
  SPAM: ['NEW'],
};

const CONVERTIBLE_STATUSES: readonly EnquiryStatus[] = [
  EnquiryStatus.QUALIFIED,
  EnquiryStatus.CONSULTATION_BOOKED,
];

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

export function assertEnquiryCanConvert(status: EnquiryStatus): void {
  if (!CONVERTIBLE_STATUSES.includes(status)) {
    throw new BadRequestException(
      'Only qualified enquiries or booked consultations can be converted',
    );
  }
}
