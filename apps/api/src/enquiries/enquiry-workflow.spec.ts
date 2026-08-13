import { BadRequestException } from '@nestjs/common';
import { EnquiryStatus } from '../generated/prisma/enums';
import { assertValidEnquiryTransition } from './enquiry-workflow';

describe('assertValidEnquiryTransition', () => {
  it('accepts a valid progression', () => {
    expect(() =>
      assertValidEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.CONTACTED),
    ).not.toThrow();
  });

  it('allows the existing status to remain unchanged', () => {
    expect(() =>
      assertValidEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.NEW),
    ).not.toThrow();
  });

  it('allows an update when no new status is supplied', () => {
    expect(() => assertValidEnquiryTransition(EnquiryStatus.NEW)).not.toThrow();
  });

  it('rejects skipping directly from NEW to CONVERTED', () => {
    expect(() =>
      assertValidEnquiryTransition(EnquiryStatus.NEW, EnquiryStatus.CONVERTED),
    ).toThrow(BadRequestException);
  });

  it('prevents changes after conversion', () => {
    expect(() =>
      assertValidEnquiryTransition(
        EnquiryStatus.CONVERTED,
        EnquiryStatus.CLOSED,
      ),
    ).toThrow(BadRequestException);
  });

  it('allows a closed enquiry to be reopened as contacted', () => {
    expect(() =>
      assertValidEnquiryTransition(
        EnquiryStatus.CLOSED,
        EnquiryStatus.CONTACTED,
      ),
    ).not.toThrow();
  });

  it('allows a spam enquiry to be restored for review', () => {
    expect(() =>
      assertValidEnquiryTransition(EnquiryStatus.SPAM, EnquiryStatus.NEW),
    ).not.toThrow();
  });
});
