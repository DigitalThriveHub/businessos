import { enquiryContextFromJwt } from './enquiry-context';

describe('enquiryContextFromJwt', () => {
  it('maps Supabase aal2 into the database assurance enum', () => {
    expect(
      enquiryContextFromJwt(
        {
          sub: 'user-id',
          aal: 'aal2',
        },
        'organisation-id',
      ),
    ).toEqual({
      userId: 'user-id',
      organisationId: 'organisation-id',
      aal: 'AAL2',
    });
  });

  it('defaults an authenticated aal1 session to AAL1', () => {
    expect(
      enquiryContextFromJwt(
        {
          sub: 'user-id',
          aal: 'aal1',
        },
        'organisation-id',
      ),
    ).toEqual({
      userId: 'user-id',
      organisationId: 'organisation-id',
      aal: 'AAL1',
    });
  });

  it('fails closed when the authenticated subject is absent', () => {
    expect(() => enquiryContextFromJwt({}, 'organisation-id')).toThrow(
      'Authenticated user context is missing',
    );
  });
});
