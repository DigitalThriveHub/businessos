import { createHash } from 'node:crypto';

import { Injectable } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';

import {
  type GoogleProviderSecret,
  ProviderSecretResolver,
} from './provider-secret-resolver.service';
import {
  providerFetch,
  readJson,
  safeProviderId,
  stripHtml,
} from './provider-http';
import type {
  CalendarProviderInput,
  CalendarProviderReceipt,
  DeliveryJob,
  InboundProviderMessage,
  ProviderDeliveryReceipt,
  ProviderRuntimeContext,
  ProviderSyncResult,
} from './provider.types';
import { ProviderOperationError } from './provider.types';

type TokenRecord = { token: string; expiresAt: number };
type GmailHeader = { name?: string; value?: string };
type GmailPart = {
  mimeType?: string;
  headers?: GmailHeader[];
  body?: { data?: string };
  parts?: GmailPart[];
};
type GmailMessage = {
  id?: string;
  threadId?: string;
  internalDate?: string;
  historyId?: string;
  payload?: GmailPart;
};

const GOOGLE_JWKS = createRemoteJWKSet(
  new URL('https://www.googleapis.com/oauth2/v3/certs'),
);

@Injectable()
export class GoogleWorkspaceProvider {
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(private readonly secrets: ProviderSecretResolver) {}

  async health(context: ProviderRuntimeContext): Promise<void> {
    const secret = this.secret(context);
    await this.google(
      secret,
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/profile`,
      { method: 'GET' },
    );
  }

  async send(job: DeliveryJob): Promise<ProviderDeliveryReceipt> {
    const secret = this.secretFromJob(job);
    const raw = this.mimeMessage(
      secret.mailboxAddress,
      job.recipientAddresses,
      job.subject ?? 'Message from BusinessOS',
      job.bodyText,
      job.messageId,
      job.idempotencyKey,
    );
    const response = await this.google(
      secret,
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/messages/send`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ raw }),
      },
    );
    const sent = await readJson<{ id?: string }>('GOOGLE_GMAIL', response);
    return {
      provider: 'google_workspace',
      messageId: safeProviderId(sent.id ?? ''),
    };
  }

  async createCalendarEvent(
    context: ProviderRuntimeContext,
    input: CalendarProviderInput,
  ): Promise<CalendarProviderReceipt> {
    const secret = this.secret(context);
    const providerEventId = input.eventId.replaceAll('-', '');
    const createResponse = await this.google(
      secret,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(secret.calendarId)}/events?conferenceDataVersion=1&sendUpdates=all`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: providerEventId,
          summary: input.title,
          description: input.description ?? undefined,
          location: input.location ?? undefined,
          start: {
            dateTime: input.startsAt.toISOString(),
            timeZone: input.timezone,
          },
          end: {
            dateTime: input.endsAt.toISOString(),
            timeZone: input.timezone,
          },
          attendees: input.attendeeAddresses.map((email) => ({ email })),
          reminders:
            input.reminderMinutesBefore === null
              ? { useDefault: true }
              : {
                  useDefault: false,
                  overrides: [
                    { method: 'email', minutes: input.reminderMinutesBefore },
                  ],
                },
          extendedProperties: {
            private: {
              businessOsEventId: input.eventId,
              businessOsIdempotencyKey: input.idempotencyKey,
            },
          },
          conferenceData: {
            createRequest: {
              requestId: input.eventId.replaceAll('-', ''),
              conferenceSolutionKey: { type: 'hangoutsMeet' },
            },
          },
        }),
      },
      [200, 201, 409],
    );
    const response =
      createResponse.status === 409
        ? await this.google(
            secret,
            `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(secret.calendarId)}/events/${encodeURIComponent(providerEventId)}`,
            { method: 'GET' },
          )
        : createResponse;
    const event = await readJson<{
      id?: string;
      hangoutLink?: string;
      conferenceData?: {
        entryPoints?: Array<{ entryPointType?: string; uri?: string }>;
      };
    }>('GOOGLE_CALENDAR', response);
    return {
      providerEventId: event.id ?? '',
      joinUrl:
        event.hangoutLink ??
        event.conferenceData?.entryPoints?.find(
          (entry) => entry.entryPointType === 'video',
        )?.uri ??
        null,
    };
  }

  async cancelCalendarEvent(
    context: ProviderRuntimeContext,
    providerEventId: string,
  ): Promise<void> {
    const secret = this.secret(context);
    await this.google(
      secret,
      `https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(secret.calendarId)}/events/${encodeURIComponent(providerEventId)}?sendUpdates=all`,
      { method: 'DELETE' },
      [204, 404, 410],
    );
  }

  async sync(context: ProviderRuntimeContext): Promise<ProviderSyncResult> {
    const secret = this.secret(context);
    const ids = new Set<string>();
    let nextCursor: string | null = context.syncCursor;
    let snapshotCursor: string | null = null;

    if (context.syncCursor) {
      try {
        const cursor = this.decodeHistoryCursor(context.syncCursor);
        let pageToken = cursor.pageToken;
        let observedHistoryId = cursor.historyId;
        for (let page = 0; page < 5; page += 1) {
          const query = new URLSearchParams({
            startHistoryId: cursor.historyId,
            historyTypes: 'messageAdded',
            maxResults: '100',
          });
          if (pageToken) query.set('pageToken', pageToken);
          const response = await this.google(
            secret,
            `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/history?${query.toString()}`,
            { method: 'GET' },
          );
          const data = await readJson<{
            historyId?: string;
            nextPageToken?: string;
            history?: Array<{
              messagesAdded?: Array<{ message?: { id?: string } }>;
            }>;
          }>('GOOGLE_GMAIL', response);
          for (const history of data.history ?? []) {
            for (const added of history.messagesAdded ?? []) {
              if (added.message?.id) ids.add(added.message.id);
            }
          }
          observedHistoryId = data.historyId ?? observedHistoryId;
          pageToken = data.nextPageToken;
          if (!pageToken) {
            nextCursor = observedHistoryId;
            break;
          }
          if (page === 4) {
            nextCursor = this.encodeHistoryCursor({
              historyId: cursor.historyId,
              pageToken,
            });
          }
        }
      } catch (error) {
        if (
          !(error instanceof ProviderOperationError) ||
          error.code !== 'GOOGLE_HTTP_404'
        ) {
          throw error;
        }
        nextCursor = null;
      }
    }

    if (!nextCursor) {
      snapshotCursor = await this.profileHistoryId(secret);
      const query = new URLSearchParams({
        maxResults: '50',
        q: 'newer_than:7d -in:sent',
      });
      const response = await this.google(
        secret,
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/messages?${query.toString()}`,
        { method: 'GET' },
      );
      const list = await readJson<{ messages?: Array<{ id?: string }> }>(
        'GOOGLE_GMAIL',
        response,
      );
      for (const item of list.messages ?? []) if (item.id) ids.add(item.id);
    }

    const messages: InboundProviderMessage[] = [];
    for (const id of ids) {
      const response = await this.google(
        secret,
        `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/messages/${encodeURIComponent(id)}?format=full`,
        { method: 'GET' },
      );
      const message = await readJson<GmailMessage>('GOOGLE_GMAIL', response);
      const mapped = this.mapMessage(message, secret.mailboxAddress);
      if (mapped) messages.push(mapped);
    }

    nextCursor = snapshotCursor ?? nextCursor;
    if (!nextCursor) {
      throw new ProviderOperationError(
        'GOOGLE_CURSOR_MISSING',
        'Google did not return a mailbox history cursor.',
        true,
      );
    }
    return { messages, nextCursor };
  }

  private decodeHistoryCursor(value: string): {
    historyId: string;
    pageToken?: string;
  } {
    if (!value.startsWith('gmail-v1:')) return { historyId: value };
    try {
      const parsed = JSON.parse(
        Buffer.from(value.slice('gmail-v1:'.length), 'base64url').toString(
          'utf8',
        ),
      ) as { historyId?: unknown; pageToken?: unknown };
      if (
        typeof parsed.historyId !== 'string' ||
        !/^\d{1,40}$/.test(parsed.historyId) ||
        typeof parsed.pageToken !== 'string' ||
        parsed.pageToken.length < 1 ||
        parsed.pageToken.length > 4096
      ) {
        throw new Error('Cursor structure is invalid.');
      }
      return {
        historyId: parsed.historyId,
        pageToken: parsed.pageToken,
      };
    } catch {
      throw new ProviderOperationError(
        'GOOGLE_CURSOR_INVALID',
        'The stored Google mailbox cursor is invalid.',
        false,
      );
    }
  }

  private encodeHistoryCursor(value: {
    historyId: string;
    pageToken: string;
  }): string {
    return `gmail-v1:${Buffer.from(JSON.stringify(value), 'utf8').toString(
      'base64url',
    )}`;
  }

  private async profileHistoryId(
    secret: GoogleProviderSecret,
  ): Promise<string> {
    const response = await this.google(
      secret,
      `https://gmail.googleapis.com/gmail/v1/users/${encodeURIComponent(secret.mailboxAddress)}/profile`,
      { method: 'GET' },
    );
    const profile = await readJson<{ historyId?: string }>(
      'GOOGLE_GMAIL',
      response,
    );
    if (!profile.historyId) {
      throw new ProviderOperationError(
        'GOOGLE_CURSOR_MISSING',
        'Google did not return a mailbox history cursor.',
        true,
      );
    }
    return profile.historyId;
  }

  async verifyPushToken(
    context: ProviderRuntimeContext,
    authorization: string | undefined,
  ): Promise<void> {
    const secret = this.secret(context);
    if (
      !secret.pubsubAudience ||
      !secret.pubsubServiceAccountEmail ||
      !authorization?.startsWith('Bearer ')
    ) {
      throw new ProviderOperationError(
        'GOOGLE_PUSH_AUTH_UNAVAILABLE',
        'Google Pub/Sub push authentication is not configured.',
        false,
      );
    }
    try {
      const verified = await jwtVerify(authorization.slice(7), GOOGLE_JWKS, {
        audience: secret.pubsubAudience,
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
      });
      const emailVerified = verified.payload.email_verified;
      if (
        verified.payload.email !== secret.pubsubServiceAccountEmail ||
        (emailVerified !== true && emailVerified !== 'true')
      ) {
        throw new Error('Google service account identity did not match.');
      }
    } catch {
      throw new ProviderOperationError(
        'GOOGLE_PUSH_AUTH_INVALID',
        'Google Pub/Sub push authentication failed.',
        false,
      );
    }
  }

  private mapMessage(
    message: GmailMessage,
    mailbox: string,
  ): InboundProviderMessage | null {
    const id = message.id?.trim();
    const headers = new Map(
      (message.payload?.headers ?? []).map((header) => [
        header.name?.toLowerCase() ?? '',
        header.value ?? '',
      ]),
    );
    const sender = this.extractEmail(headers.get('from') ?? '');
    if (!id || !sender || sender === mailbox.toLowerCase()) return null;
    const occurredAt = new Date(Number(message.internalDate ?? ''));
    if (Number.isNaN(occurredAt.getTime())) return null;
    const bodyText = this.partText(message.payload);
    if (!bodyText) return null;
    const recipients = [headers.get('to') ?? '', headers.get('cc') ?? '']
      .flatMap((value) => value.split(','))
      .map((value) => this.extractEmail(value))
      .filter((value): value is string => Boolean(value))
      .slice(0, 20);
    return {
      externalEventId: `message:${id}`,
      providerMessageId: safeProviderId(id),
      providerThreadId: (message.threadId ?? id).slice(0, 240),
      sender,
      recipients: recipients.length > 0 ? recipients : [mailbox.toLowerCase()],
      subject: (headers.get('subject') ?? 'Inbound email').trim().slice(0, 500),
      bodyText,
      occurredAt,
    };
  }

  private partText(part: GmailPart | undefined): string {
    if (!part) return '';
    if (part.mimeType === 'text/plain' && part.body?.data) {
      return this.decode(part.body.data).trim().slice(0, 50_000);
    }
    for (const child of part.parts ?? []) {
      const text = this.partText(child);
      if (text) return text;
    }
    if (part.mimeType === 'text/html' && part.body?.data) {
      return stripHtml(this.decode(part.body.data));
    }
    return '';
  }

  private decode(value: string): string {
    return Buffer.from(
      value.replace(/-/g, '+').replace(/_/g, '/'),
      'base64',
    ).toString('utf8');
  }

  private extractEmail(value: string): string | null {
    const match = value
      .toLowerCase()
      .match(/<?([^\s<>@]+@[^\s<>@]+\.[^\s<>@]+)>?/);
    return match?.[1]?.replace(/[>,;]$/, '') ?? null;
  }

  private mimeMessage(
    from: string,
    recipients: string[],
    subject: string,
    body: string,
    messageId: string,
    idempotencyKey: string,
  ): string {
    const safeSubject = subject.replace(/[\r\n]+/g, ' ').slice(0, 500);
    const lines = [
      `From: ${from}`,
      `To: ${recipients.join(', ')}`,
      `Subject: ${safeSubject}`,
      'MIME-Version: 1.0',
      'Content-Type: text/plain; charset=UTF-8',
      'Content-Transfer-Encoding: 8bit',
      `X-BusinessOS-Message-Id: ${messageId}`,
      `X-BusinessOS-Idempotency-Key: ${idempotencyKey}`,
      '',
      body,
    ];
    return Buffer.from(lines.join('\r\n'), 'utf8')
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/g, '');
  }

  private secret(context: ProviderRuntimeContext): GoogleProviderSecret {
    return this.secrets.resolve(context.secretReference, 'GOOGLE_WORKSPACE');
  }

  private secretFromJob(job: DeliveryJob): GoogleProviderSecret {
    if (!job.secretReference) {
      throw new ProviderOperationError(
        'PROVIDER_SECRET_UNAVAILABLE',
        'The provider credential is unavailable.',
        false,
      );
    }
    return this.secrets.resolve(job.secretReference, 'GOOGLE_WORKSPACE');
  }

  private async token(secret: GoogleProviderSecret): Promise<string> {
    const cacheKey = createHash('sha256')
      .update(secret.clientId)
      .update('\0')
      .update(secret.refreshToken)
      .digest('hex');
    const cached = this.tokens.get(cacheKey);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const response = await providerFetch(
      'GOOGLE_OAUTH',
      'https://oauth2.googleapis.com/token',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({
          client_id: secret.clientId,
          client_secret: secret.clientSecret,
          refresh_token: secret.refreshToken,
          grant_type: 'refresh_token',
        }),
      },
      [200],
    );
    const token = await readJson<{
      access_token?: string;
      expires_in?: number;
    }>('GOOGLE_OAUTH', response);
    if (!token.access_token) {
      throw new ProviderOperationError(
        'GOOGLE_TOKEN_INVALID',
        'Google did not return an access token.',
        true,
      );
    }
    this.tokens.set(cacheKey, {
      token: token.access_token,
      expiresAt: Date.now() + Math.max(300, token.expires_in ?? 3600) * 1000,
    });
    return token.access_token;
  }

  private async google(
    secret: GoogleProviderSecret,
    url: string,
    init: RequestInit,
    statuses: readonly number[] = [200, 201],
  ): Promise<Response> {
    const token = await this.token(secret);
    return providerFetch(
      'GOOGLE',
      url,
      {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      },
      statuses,
    );
  }
}
