import { Injectable } from '@nestjs/common';

import {
  type MicrosoftProviderSecret,
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

type GraphMessage = {
  id?: string;
  conversationId?: string;
  subject?: string;
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  from?: { emailAddress?: { address?: string } };
  toRecipients?: Array<{ emailAddress?: { address?: string } }>;
  ccRecipients?: Array<{ emailAddress?: { address?: string } }>;
};

@Injectable()
export class MicrosoftGraphProvider {
  private readonly tokens = new Map<string, TokenRecord>();

  constructor(private readonly secrets: ProviderSecretResolver) {}

  async health(context: ProviderRuntimeContext): Promise<void> {
    const secret = this.secret(context);
    await this.graph(
      secret,
      `/users/${encodeURIComponent(secret.mailboxUserId)}?$select=id,mail,userPrincipalName`,
      {
        method: 'GET',
      },
    );
  }

  async send(job: DeliveryJob): Promise<ProviderDeliveryReceipt> {
    const secret = this.secretFromJob(job);
    const mailbox = encodeURIComponent(secret.mailboxUserId);
    const draftResponse = await this.graph(
      secret,
      `/users/${mailbox}/messages`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          subject: job.subject ?? 'Message from BusinessOS',
          body: { contentType: 'Text', content: job.bodyText },
          toRecipients: job.recipientAddresses.map((address) => ({
            emailAddress: { address },
          })),
          internetMessageHeaders: [
            { name: 'X-BusinessOS-Message-Id', value: job.messageId },
            { name: 'X-BusinessOS-Idempotency-Key', value: job.idempotencyKey },
          ],
        }),
      },
    );
    const draft = await readJson<{ id?: string }>(
      'MICROSOFT_GRAPH',
      draftResponse,
    );
    const messageId = safeProviderId(draft.id ?? '');
    await this.graph(
      secret,
      `/users/${mailbox}/messages/${encodeURIComponent(messageId)}/send`,
      { method: 'POST', headers: { 'Content-Length': '0' } },
      [202],
    );
    return { provider: 'microsoft_365', messageId };
  }

  async createCalendarEvent(
    context: ProviderRuntimeContext,
    input: CalendarProviderInput,
  ): Promise<CalendarProviderReceipt> {
    const secret = this.secret(context);
    const response = await this.graph(
      secret,
      `/users/${encodeURIComponent(secret.mailboxUserId)}/events`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Prefer: 'outlook.timezone="UTC"',
        },
        body: JSON.stringify({
          subject: input.title,
          body: { contentType: 'Text', content: input.description ?? '' },
          start: {
            dateTime: input.startsAt.toISOString().replace(/Z$/, ''),
            timeZone: 'UTC',
          },
          end: {
            dateTime: input.endsAt.toISOString().replace(/Z$/, ''),
            timeZone: 'UTC',
          },
          location: input.location
            ? { displayName: input.location }
            : undefined,
          attendees: input.attendeeAddresses.map((address) => ({
            emailAddress: { address },
            type: 'required',
          })),
          allowNewTimeProposals: true,
          isReminderOn: input.reminderMinutesBefore !== null,
          reminderMinutesBeforeStart: input.reminderMinutesBefore ?? 15,
          transactionId: input.idempotencyKey.slice(0, 255),
          isOnlineMeeting: true,
          onlineMeetingProvider: 'teamsForBusiness',
        }),
      },
    );
    const event = await readJson<{
      id?: string;
      onlineMeeting?: { joinUrl?: string };
      onlineMeetingUrl?: string;
    }>('MICROSOFT_GRAPH', response);
    return {
      providerEventId: event.id ?? '',
      joinUrl: event.onlineMeeting?.joinUrl ?? event.onlineMeetingUrl ?? null,
    };
  }

  async cancelCalendarEvent(
    context: ProviderRuntimeContext,
    providerEventId: string,
  ): Promise<void> {
    const secret = this.secret(context);
    await this.graph(
      secret,
      `/users/${encodeURIComponent(secret.mailboxUserId)}/events/${encodeURIComponent(providerEventId)}`,
      { method: 'DELETE' },
      [204, 404],
    );
  }

  async sync(context: ProviderRuntimeContext): Promise<ProviderSyncResult> {
    const secret = this.secret(context);
    const base = `https://graph.microsoft.com/v1.0/users/${encodeURIComponent(
      secret.mailboxUserId,
    )}/mailFolders/inbox/messages/delta`;
    let url =
      context.syncCursor ??
      `${base}?$select=id,conversationId,subject,receivedDateTime,body,from,toRecipients,ccRecipients&$top=50`;
    const messages: InboundProviderMessage[] = [];
    let cursor = context.syncCursor ?? url;

    for (let page = 0; page < 5; page += 1) {
      const response = await this.graphAbsolute(secret, url, { method: 'GET' });
      const data = await readJson<{
        value?: GraphMessage[];
        '@odata.nextLink'?: string;
        '@odata.deltaLink'?: string;
      }>('MICROSOFT_GRAPH', response);
      for (const message of data.value ?? []) {
        const mapped = this.mapMessage(message);
        if (mapped) messages.push(mapped);
      }
      if (data['@odata.deltaLink']) {
        cursor = data['@odata.deltaLink'];
      } else if (data['@odata.nextLink']) {
        // Persist the continuation URL when a busy mailbox exceeds this
        // worker cycle. Advancing to the original delta URL here would
        // repeatedly ingest only the first pages and starve older mail.
        cursor = data['@odata.nextLink'];
      }
      if (!data['@odata.nextLink']) break;
      url = data['@odata.nextLink'];
    }
    return { messages: messages.slice(0, 250), nextCursor: cursor };
  }

  webhookClientState(context: ProviderRuntimeContext): string {
    return this.secret(context).webhookClientState;
  }

  private mapMessage(message: GraphMessage): InboundProviderMessage | null {
    const id = message.id?.trim();
    const sender = message.from?.emailAddress?.address?.trim().toLowerCase();
    const occurredAt = new Date(message.receivedDateTime ?? '');
    if (!id || !sender || Number.isNaN(occurredAt.getTime())) return null;
    const body = message.body?.content ?? '';
    const bodyText =
      message.body?.contentType?.toLowerCase() === 'html'
        ? stripHtml(body)
        : body.trim().slice(0, 50_000);
    if (!bodyText) return null;
    return {
      externalEventId: `message:${id}`,
      providerMessageId: safeProviderId(id),
      providerThreadId: (message.conversationId ?? id).slice(0, 240),
      sender,
      recipients: [
        ...(message.toRecipients ?? []),
        ...(message.ccRecipients ?? []),
      ]
        .map((recipient) =>
          recipient.emailAddress?.address?.trim().toLowerCase(),
        )
        .filter((value): value is string => Boolean(value))
        .slice(0, 20),
      subject: (message.subject ?? 'Inbound email').trim().slice(0, 500),
      bodyText,
      occurredAt,
    };
  }

  private secret(context: ProviderRuntimeContext): MicrosoftProviderSecret {
    return this.secrets.resolve(context.secretReference, 'MICROSOFT_365');
  }

  private secretFromJob(job: DeliveryJob): MicrosoftProviderSecret {
    if (!job.secretReference) {
      throw new ProviderOperationError(
        'PROVIDER_SECRET_UNAVAILABLE',
        'The provider credential is unavailable.',
        false,
      );
    }
    return this.secrets.resolve(job.secretReference, 'MICROSOFT_365');
  }

  private async token(secret: MicrosoftProviderSecret): Promise<string> {
    const key = `${secret.tenantId}:${secret.clientId}`;
    const cached = this.tokens.get(key);
    if (cached && cached.expiresAt > Date.now() + 60_000) return cached.token;
    const body = new URLSearchParams({
      client_id: secret.clientId,
      client_secret: secret.clientSecret,
      scope: 'https://graph.microsoft.com/.default',
      grant_type: 'client_credentials',
    });
    const response = await providerFetch(
      'MICROSOFT_OAUTH',
      `https://login.microsoftonline.com/${encodeURIComponent(secret.tenantId)}/oauth2/v2.0/token`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
        body,
      },
      [200],
    );
    const token = await readJson<{
      access_token?: string;
      expires_in?: number;
    }>('MICROSOFT_OAUTH', response);
    if (!token.access_token) {
      throw new ProviderOperationError(
        'MICROSOFT_TOKEN_INVALID',
        'Microsoft did not return an access token.',
        true,
      );
    }
    this.tokens.set(key, {
      token: token.access_token,
      expiresAt: Date.now() + Math.max(300, token.expires_in ?? 3600) * 1000,
    });
    return token.access_token;
  }

  private async graph(
    secret: MicrosoftProviderSecret,
    path: string,
    init: RequestInit,
    statuses: readonly number[] = [200, 201],
  ): Promise<Response> {
    return this.graphAbsolute(
      secret,
      `https://graph.microsoft.com/v1.0${path}`,
      init,
      statuses,
    );
  }

  private async graphAbsolute(
    secret: MicrosoftProviderSecret,
    url: string,
    init: RequestInit,
    statuses: readonly number[] = [200, 201],
  ): Promise<Response> {
    let target: URL;
    try {
      target = new URL(url);
    } catch {
      throw new ProviderOperationError(
        'MICROSOFT_GRAPH_URL_INVALID',
        'Microsoft returned an invalid continuation URL.',
        false,
      );
    }
    if (target.origin !== 'https://graph.microsoft.com') {
      throw new ProviderOperationError(
        'MICROSOFT_GRAPH_URL_REJECTED',
        'Microsoft returned an unsupported continuation URL.',
        false,
      );
    }
    const token = await this.token(secret);
    return providerFetch(
      'MICROSOFT_GRAPH',
      target.toString(),
      {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
      },
      statuses,
    );
  }
}
