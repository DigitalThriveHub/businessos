export interface AuthenticatedUser {
  id: string;
  email?: string;
  organisationId: string;
  membershipId: string;
  permissions: string[];
}