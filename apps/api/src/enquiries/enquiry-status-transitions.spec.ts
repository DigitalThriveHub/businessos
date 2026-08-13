/// <reference types="jest" />

import { BadRequestException } from '@nestjs/common';
import { EnquiryStatus } from '../generated/prisma/enums';
import { assertValidEnquiryStatusTransition } from './enquiry-status-transitions';

describe('assertValidEnquiryStatusTransition', () => {
  it('allows a valid transition', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(
        EnquiryStatus.NEW,
        EnquiryStatus.CONTACTED,
      ),
    ).not.toThrow();
  });

  it('allows the status to remain unchanged', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(
        EnquiryStatus.QUALIFIED,
        EnquiryStatus.QUALIFIED,
      ),
    ).not.toThrow();
  });

  it('allows a qualified enquiry to book a consultation', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(
        EnquiryStatus.QUALIFIED,
        EnquiryStatus.CONSULTATION_BOOKED,
      ),
    ).not.toThrow();
  });

  it('rejects skipping directly from new to converted', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(
        EnquiryStatus.NEW,
        EnquiryStatus.CONVERTED,
      ),
    ).toThrow(BadRequestException);
  });

  it('rejects changes after conversion', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(
        EnquiryStatus.CONVERTED,
        EnquiryStatus.NEW,
      ),
    ).toThrow(BadRequestException);
  });

  it('allows a spam enquiry to be restored to new', () => {
    expect(() =>
      assertValidEnquiryStatusTransition(EnquiryStatus.SPAM, EnquiryStatus.NEW),
    ).not.toThrow();
  });
});
