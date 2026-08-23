# Gate F integration function text-contract hotfix

This focused migration corrects PostgreSQL `RETURNS TABLE` type contracts for
integration connection creation, status changes, secret rotation and signed
intake lookup. Stored `varchar` values are explicitly cast to the declared
`text` boundary type.

Apply the migration, then rerun only the Gate F browser acceptance test. The
migration does not delete or rewrite integration, enquiry, finance or audit
data and preserves the existing SECURITY DEFINER, AAL2, RBAC and execute-grant
boundaries.
