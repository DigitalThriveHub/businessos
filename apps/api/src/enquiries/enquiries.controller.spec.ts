import { Test, TestingModule } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth/jwt-auth.guard';
import { OrganisationAccessGuard } from '../auth/guards/organisation-access/organisation-access.guard';
import { PermissionGuard } from '../auth/guards/permission/permission.guard';
import { EnquiriesController } from './enquiries.controller';
import { EnquiriesService } from './enquiries.service';

describe('EnquiriesController', () => {
  let controller: EnquiriesController;

  const enquiriesServiceMock = {
    create: jest.fn(),
    findAll: jest.fn(),
    findOne: jest.fn(),
    update: jest.fn(),
    remove: jest.fn(),
  };

  const allowGuardMock = {
    canActivate: jest.fn().mockReturnValue(true),
  };

  beforeEach(async () => {
    const moduleBuilder = Test.createTestingModule({
      controllers: [EnquiriesController],
      providers: [
        {
          provide: EnquiriesService,
          useValue: enquiriesServiceMock,
        },
      ],
    });

    const module: TestingModule = await moduleBuilder
      .overrideGuard(JwtAuthGuard)
      .useValue(allowGuardMock)
      .overrideGuard(OrganisationAccessGuard)
      .useValue(allowGuardMock)
      .overrideGuard(PermissionGuard)
      .useValue(allowGuardMock)
      .compile();

    controller = module.get<EnquiriesController>(EnquiriesController);
  });

  afterEach(() => {
    jest.clearAllMocks();
  });

  it('is defined with its service dependency', () => {
    expect(controller).toBeDefined();
  });
});
