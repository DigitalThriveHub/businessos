export interface BootstrapActor {
  userId: string;
  email: string;
}

export interface BootstrapOrganisationResult {
  organisationId: string;
  organisationSlug: string;
  membershipId: string;
  ownerRoleId: string;
  ownerRoleAssignmentId: string;
  status: 'ACTIVE';
}
