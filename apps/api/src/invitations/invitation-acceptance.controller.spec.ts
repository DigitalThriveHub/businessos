import {
  Test,
  type TestingModule,
} from '@nestjs/testing';

import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import type {
  VerifiedUserJwtPayload,
} from '../auth/verified-jwt-payload';
import type { AcceptOrganisationInvitationDto } from './dto/accept-organisation-invitation.dto';
import { InvitationAcceptanceController } from './invitation-acceptance.controller';
import { InvitationAcceptanceService } from './invitation-acceptance.service';

const USER_ID =
  '11111111-1111-4111-8111-111111111111';
const RAW_TOKEN =
  `boi_v1_${'A'.repeat(43)}`;

describe('InvitationAcceptanceController', () => {
  let controller: InvitationAcceptanceController;

  const acceptanceServiceMock = {
    accept: jest.fn(),
  };

  const allowGuardMock = {
    canActivate: jest.fn(),
  };

  beforeEach(async () => {
    jest.resetAllMocks();

    allowGuardMock.canActivate.mockReturnValue(
      true,
    );

    const moduleBuilder =
      Test.createTestingModule({
        controllers: [
          InvitationAcceptanceController,
        ],
        providers: [
          {
            provide:
              InvitationAcceptanceService,
            useValue: acceptanceServiceMock,
          },
        ],
      });

    const module: TestingModule =
      await moduleBuilder
        .overrideGuard(JwtAuthGuard)
        .useValue(allowGuardMock)
        .compile();

    controller =
      module.get<InvitationAcceptanceController>(
        InvitationAcceptanceController,
      );
  });

  it('is defined with its service dependency', () => {
    expect(controller).toBeDefined();
  });

  it('passes only the authenticated user and validated token to the service', async () => {
    const user = {
      sub: USER_ID,
    } as VerifiedUserJwtPayload;

    const dto = {
      token: RAW_TOKEN,
    } as AcceptOrganisationInvitationDto;

    const expected = {
      invitationId:
        '44444444-4444-4444-8444-444444444444',
      status: 'ACCEPTED',
    };

    acceptanceServiceMock.accept.mockResolvedValue(
      expected,
    );

    await expect(
      controller.accept(user, dto),
    ).resolves.toBe(expected);

    expect(
      acceptanceServiceMock.accept,
    ).toHaveBeenCalledWith(
      user,
      RAW_TOKEN,
    );
  });
});