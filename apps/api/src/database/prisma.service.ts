import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PrismaClient } from '../generated/prisma/client';

interface RuntimeRoleCheck {
  currentUser: string;
  hasAppRole: boolean;
  isSuperuser: boolean;
  bypassesRls: boolean;
}

@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  constructor(config: ConfigService) {
    const adapter = new PrismaPg({
      connectionString: config.getOrThrow<string>('DATABASE_URL'),
      max: config.getOrThrow<number>('DATABASE_POOL_MAX'),
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 30_000,

      ssl: {
        ca: readFileSync(
          resolve(process.cwd(), 'certs', 'supabase-ca.crt'),
          'utf8',
        ),
        rejectUnauthorized: true,
      },
    });

    super({
      adapter,
      log: ['warn', 'error'],
    });
  }

  async onModuleInit(): Promise<void> {
    await this.$connect();

    const [role] = await this.$queryRaw<RuntimeRoleCheck[]>`
      SELECT
        current_user AS "currentUser",
        pg_has_role(
          current_user,
          'businessos_app',
          'member'
        ) AS "hasAppRole",
        roles.rolsuper AS "isSuperuser",
        roles.rolbypassrls AS "bypassesRls"
      FROM pg_catalog.pg_roles AS roles
      WHERE roles.rolname = current_user
    `;

    if (
      !role ||
      role.currentUser !== 'businessos_runtime' ||
      !role.hasAppRole ||
      role.isSuperuser ||
      role.bypassesRls
    ) {
      throw new Error(
        'Unsafe database role: the API must use businessos_runtime with RLS enabled',
      );
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
