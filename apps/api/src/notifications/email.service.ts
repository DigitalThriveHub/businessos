import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Resend } from 'resend';

import type { Environment } from '../config/env.validation';

export interface SendOrganisationInvitationEmailInput {
  invitationId: string;
  recipientEmail: string;
  organisationName: string;
  inviterName?: string | null;
  invitationToken: string;
  expiresAt: Date;
}

export interface EmailDeliveryReceipt {
  provider: 'resend';
  messageId: string;
}

export interface SendClientPortalInvitationEmailInput {
  invitationId: string;
  recipientEmail: string;
  organisationName: string;
  clientName: string;
  invitationToken: string;
  expiresAt: Date;
}

export interface SendTransactionalEmailInput {
  messageId: string;
  recipientEmails: readonly string[];
  subject: string;
  bodyText: string;
  idempotencyKey: string;
}

export interface ResendWebhookHeaders {
  id: string;
  timestamp: string;
  signature: string;
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (character) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#039;',
      })[character] ?? character,
  );
}

function safeSingleLine(value: string): string {
  return value
    .replace(/[\r\n\u2028\u2029]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

@Injectable()
export class EmailService {
  private resendClient: Resend | null = null;

  constructor(private readonly config: ConfigService<Environment, true>) {}

  async sendOrganisationInvitation(
    input: SendOrganisationInvitationEmailInput,
  ): Promise<EmailDeliveryReceipt> {
    const resend = this.getResendClient();

    const webAppUrl = this.config.get('WEB_APP_URL', { infer: true });

    const fromAddress = this.config.get('EMAIL_FROM_ADDRESS', { infer: true });

    const fromName =
      this.config.get('EMAIL_FROM_NAME', {
        infer: true,
      }) ?? 'BusinessOS';

    const replyTo = this.config.get('EMAIL_REPLY_TO', { infer: true });

    if (!webAppUrl || !fromAddress) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    const invitationUrl = new URL('/invitations/accept', webAppUrl);

    invitationUrl.searchParams.set('token', input.invitationToken);

    const organisationName = safeSingleLine(input.organisationName);

    const inviterName = input.inviterName
      ? safeSingleLine(input.inviterName)
      : 'An authorised administrator';

    const recipientEmail = safeSingleLine(input.recipientEmail);

    const expiresAt = input.expiresAt.toUTCString();

    const safeFromName = safeSingleLine(fromName)
      .replace(/[<>]/g, '')
      .slice(0, 100);

    const escapedOrganisation = escapeHtml(organisationName);

    const escapedInviter = escapeHtml(inviterName);
    const escapedInvitationUrl = escapeHtml(invitationUrl.toString());
    const escapedExpiresAt = escapeHtml(expiresAt);

    const result = await resend.emails.send(
      {
        from: `${safeFromName} <${fromAddress}>`,
        to: [recipientEmail],
        ...(replyTo
          ? {
              replyTo,
            }
          : {}),
        subject: 'You have been invited to join BusinessOS',
        text: [
          `You have been invited to join ${organisationName} on BusinessOS.`,
          '',
          `${inviterName} sent this invitation.`,
          '',
          `Accept invitation: ${invitationUrl.toString()}`,
          '',
          `This invitation expires at ${expiresAt}.`,
          '',
          'If you were not expecting this invitation, you can safely ignore this email.',
          'Do not forward this email because its invitation link is personal to you.',
        ].join('\n'),
        html: `
          <!doctype html>
          <html lang="en">
            <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
              <div style="padding:32px 16px;">
                <div style="max-width:600px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
                  <div style="background:#020617;padding:24px 32px;color:#ffffff;">
                    <strong style="font-size:20px;">BusinessOS</strong>
                    <div style="margin-top:4px;color:#cbd5e1;font-size:13px;">
                      Secure business operations
                    </div>
                  </div>

                  <div style="padding:32px;">
                    <h1 style="margin:0;font-size:24px;line-height:1.3;">
                      Join ${escapedOrganisation}
                    </h1>

                    <p style="margin:20px 0 0;line-height:1.7;color:#475569;">
                      ${escapedInviter} has invited you to join
                      <strong>${escapedOrganisation}</strong>
                      on BusinessOS.
                    </p>

                    <div style="margin:28px 0;">
                      <a
                        href="${escapedInvitationUrl}"
                        style="display:inline-block;background:#020617;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;"
                      >
                        Accept invitation
                      </a>
                    </div>

                    <p style="margin:0;line-height:1.7;color:#64748b;font-size:14px;">
                      This invitation expires at ${escapedExpiresAt}.
                    </p>

                    <div style="margin-top:28px;padding-top:20px;border-top:1px solid #e2e8f0;color:#64748b;font-size:13px;line-height:1.6;">
                      If you were not expecting this invitation, safely ignore this email.
                      Do not forward it because the invitation link is personal to you.
                    </div>
                  </div>
                </div>
              </div>
            </body>
          </html>
        `,
      },
      {
        idempotencyKey: `organisation-invitation/${input.invitationId}`,
      },
    );

    if (result.error || !result.data?.id) {
      throw new ServiceUnavailableException(
        'The invitation email could not be delivered.',
      );
    }

    return {
      provider: 'resend',
      messageId: result.data.id,
    };
  }

  async sendClientPortalInvitation(
    input: SendClientPortalInvitationEmailInput,
  ): Promise<EmailDeliveryReceipt> {
    const webAppUrl = this.config.get('WEB_APP_URL', { infer: true });

    if (!webAppUrl) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    const invitationUrl = new URL('/portal/invitations/accept', webAppUrl);
    invitationUrl.searchParams.set('token', input.invitationToken);

    const organisationName = safeSingleLine(input.organisationName);
    const clientName = safeSingleLine(input.clientName);
    const expiresAt = input.expiresAt.toUTCString();

    return this.sendEmail({
      recipientEmails: [safeSingleLine(input.recipientEmail)],
      subject: `Secure client portal invitation from ${organisationName}`,
      bodyText: [
        `Hello ${clientName},`,
        '',
        `${organisationName} has invited you to its secure BusinessOS client portal.`,
        '',
        `Accept invitation: ${invitationUrl.toString()}`,
        '',
        `This invitation expires at ${expiresAt}.`,
        '',
        'Only accept this invitation using the email address to which it was sent.',
        'Do not forward this email because its invitation link is personal to you.',
      ].join('\n'),
      htmlBody: `
        <h1 style="margin:0;font-size:24px;line-height:1.3;">Your secure client portal</h1>
        <p style="margin:20px 0 0;line-height:1.7;color:#475569;">
          Hello ${escapeHtml(clientName)}, ${escapeHtml(organisationName)} has invited
          you to view authorised case progress, documents and messages securely.
        </p>
        <div style="margin:28px 0;">
          <a href="${escapeHtml(invitationUrl.toString())}"
             style="display:inline-block;background:#020617;color:#ffffff;text-decoration:none;padding:13px 22px;border-radius:10px;font-weight:600;">
            Accept secure invitation
          </a>
        </div>
        <p style="margin:0;line-height:1.7;color:#64748b;font-size:14px;">
          This invitation expires at ${escapeHtml(expiresAt)}. Sign in with the
          same email address that received this message.
        </p>
      `,
      idempotencyKey: `client-portal-invitation/${input.invitationId}`,
    });
  }

  async sendTransactionalMessage(
    input: SendTransactionalEmailInput,
  ): Promise<EmailDeliveryReceipt> {
    return this.sendEmail({
      recipientEmails: input.recipientEmails,
      subject: safeSingleLine(
        input.subject || 'Secure message from BusinessOS',
      ),
      bodyText: input.bodyText,
      htmlBody: `
        <div style="white-space:pre-wrap;line-height:1.7;color:#334155;">${escapeHtml(
          input.bodyText,
        )}</div>
      `,
      idempotencyKey: `communication/${input.messageId}/${input.idempotencyKey}`,
    });
  }

  verifyResendWebhook(payload: string, headers: ResendWebhookHeaders): unknown {
    const secret = this.config.get('RESEND_WEBHOOK_SECRET', { infer: true });

    if (!secret) {
      throw new ServiceUnavailableException(
        'Email webhook verification is not configured.',
      );
    }

    return this.getResendClient().webhooks.verify({
      payload,
      headers,
      webhookSecret: secret,
    });
  }

  private async sendEmail(input: {
    recipientEmails: readonly string[];
    subject: string;
    bodyText: string;
    htmlBody: string;
    idempotencyKey: string;
  }): Promise<EmailDeliveryReceipt> {
    const resend = this.getResendClient();
    const fromAddress = this.config.get('EMAIL_FROM_ADDRESS', { infer: true });
    const fromName =
      this.config.get('EMAIL_FROM_NAME', { infer: true }) ?? 'BusinessOS';
    const replyTo = this.config.get('EMAIL_REPLY_TO', { infer: true });

    if (!fromAddress || input.recipientEmails.length === 0) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    const safeFromName = safeSingleLine(fromName)
      .replace(/[<>]/g, '')
      .slice(0, 100);

    const result = await resend.emails.send(
      {
        from: `${safeFromName} <${fromAddress}>`,
        to: [...input.recipientEmails],
        ...(replyTo ? { replyTo } : {}),
        subject: safeSingleLine(input.subject).slice(0, 500),
        text: input.bodyText,
        html: `
          <!doctype html>
          <html lang="en">
            <body style="margin:0;background:#f8fafc;font-family:Arial,sans-serif;color:#0f172a;">
              <div style="padding:32px 16px;">
                <div style="max-width:640px;margin:0 auto;background:#ffffff;border:1px solid #e2e8f0;border-radius:16px;overflow:hidden;">
                  <div style="background:#020617;padding:24px 32px;color:#ffffff;">
                    <strong style="font-size:20px;">BusinessOS</strong>
                    <div style="margin-top:4px;color:#cbd5e1;font-size:13px;">Secure client communication</div>
                  </div>
                  <div style="padding:32px;">${input.htmlBody}</div>
                </div>
              </div>
            </body>
          </html>
        `,
      },
      { idempotencyKey: input.idempotencyKey },
    );

    if (result.error || !result.data?.id) {
      throw new ServiceUnavailableException(
        'The email could not be delivered.',
      );
    }

    return { provider: 'resend', messageId: result.data.id };
  }

  private getResendClient(): Resend {
    if (this.resendClient) {
      return this.resendClient;
    }

    const apiKey = this.config.get('RESEND_API_KEY', { infer: true });

    if (!apiKey) {
      throw new ServiceUnavailableException(
        'Email delivery is not configured.',
      );
    }

    this.resendClient = new Resend(apiKey);

    return this.resendClient;
  }
}
