CREATE TYPE "EnquiryStatus" AS ENUM (
  'NEW',
  'CONTACTED',
  'QUALIFIED',
  'CONSULTATION_BOOKED',
  'CONVERTED',
  'CLOSED',
  'SPAM'
);

CREATE TYPE "EnquiryPriority" AS ENUM (
  'LOW',
  'NORMAL',
  'HIGH',
  'URGENT'
);

CREATE TABLE "enquiries" (
  "id" UUID NOT NULL DEFAULT gen_random_uuid(),
  "organisation_id" UUID NOT NULL,
  "assigned_to_user_id" UUID,
  "first_name" VARCHAR(100) NOT NULL,
  "last_name" VARCHAR(100),
  "email" VARCHAR(320),
  "phone" VARCHAR(50),
  "country" VARCHAR(100),
  "service_type" VARCHAR(160),
  "message" TEXT,
  "source" VARCHAR(100),
  "status" "EnquiryStatus" NOT NULL DEFAULT 'NEW',
  "priority" "EnquiryPriority" NOT NULL DEFAULT 'NORMAL',
  "next_follow_up_at" TIMESTAMPTZ(6),
  "last_contacted_at" TIMESTAMPTZ(6),
  "converted_at" TIMESTAMPTZ(6),
  "created_by_user_id" UUID,
  "updated_by_user_id" UUID,
  "created_at" TIMESTAMPTZ(6) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMPTZ(6) NOT NULL,
  "deleted_at" TIMESTAMPTZ(6),

  CONSTRAINT "enquiries_pkey" PRIMARY KEY ("id"),

  CONSTRAINT "enquiries_organisation_id_fkey"
    FOREIGN KEY ("organisation_id")
    REFERENCES "organisations"("id")
    ON DELETE RESTRICT ON UPDATE CASCADE,

  CONSTRAINT "enquiries_assigned_to_user_id_fkey"
    FOREIGN KEY ("assigned_to_user_id")
    REFERENCES "user_profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT "enquiries_created_by_user_id_fkey"
    FOREIGN KEY ("created_by_user_id")
    REFERENCES "user_profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE,

  CONSTRAINT "enquiries_updated_by_user_id_fkey"
    FOREIGN KEY ("updated_by_user_id")
    REFERENCES "user_profiles"("id")
    ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE INDEX "enquiries_organisation_id_status_created_at_idx"
  ON "enquiries"("organisation_id", "status", "created_at" DESC);

CREATE INDEX "enquiries_organisation_id_assigned_to_user_id_status_idx"
  ON "enquiries"("organisation_id", "assigned_to_user_id", "status");

CREATE INDEX "enquiries_organisation_id_email_idx"
  ON "enquiries"("organisation_id", "email");

CREATE INDEX "enquiries_organisation_id_phone_idx"
  ON "enquiries"("organisation_id", "phone");

CREATE INDEX "enquiries_organisation_id_next_follow_up_at_idx"
  ON "enquiries"("organisation_id", "next_follow_up_at");