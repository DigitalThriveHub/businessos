# Gate I — production operations and launch assurance

Gate I turns the verified BusinessOS workflows into an observable, recoverable
and securely deployable service. It adds non-root production images, isolated
runtime topology, fail-closed production configuration, worker/queue diagnostics,
recovery objectives, backup-restore freshness enforcement and launch verification.

Run `scripts/verify-gate-i.ps1 -ApplyMigration -RequireLiveGateI` for the code and complete live
regression gate. Add `-RequireProductionEvidence -ApiOrigin ... -WebOrigin ...`
only after the production deployment and recovery exercise exist.
