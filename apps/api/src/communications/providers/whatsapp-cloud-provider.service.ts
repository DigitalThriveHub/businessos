import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable } from '@nestjs/common';

import {
  ProviderSecretResolver,
  type WhatsAppProviderSecret,
} from './provider-secret-resolver.service';
import { providerFetch, readJson, safeProviderId } from './provider-http';
import type {
  DeliveryJob,
  ProviderDeliveryReceipt,
  ProviderRuntimeContext,
} from './provider.types';
import { ProviderOperationError } from './provider.types';

@Injectable()
export class WhatsAppCloudProvider {
  constructor(private readonly secrets: ProviderSecretResolver) {}

  async health(context: ProviderRuntimeContext): Promise<void> {
    const secret = this.secret(context);
    await providerFetch(
      'WHATSAPP_CLOUD',
      `https://graph.facebook.com/${secret.graphApiVersion}/${encodeURIComponent(secret.phoneNumberId)}?fields=id,display_phone_number,verified_name`,
      {
        method: 'GET',
        headers: { Authorization: `Bearer ${secret.accessToken}` },
      },
      [200],
    );
  }

  async send(job: DeliveryJob): Promise<ProviderDeliveryReceipt> {
    if (!job.secretReference || job.recipientAddresses.length !== 1) {
      throw new ProviderOperationError(
        'WHATSAPP_DELIVERY_INPUT_INVALID',
        'WhatsApp delivery requires one recipient and a configured credential.',
        false,
      );
    }
    const secret = this.secrets.resolve(
      job.secretReference,
      'WHATSAPP_BUSINESS',
    );
    const providerMessage = secret.defaultTemplateName
      ? {
          type: 'template',
          template: {
            name: secret.defaultTemplateName,
            language: { code: secret.defaultTemplateLanguage },
            components: [
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: job.bodyText.slice(0, 1024) },
                ],
              },
            ],
          },
        }
      : {
          type: 'text',
          text: { preview_url: false, body: job.bodyText.slice(0, 4096) },
        };
    const response = await providerFetch(
      'WHATSAPP_CLOUD',
      `https://graph.facebook.com/${secret.graphApiVersion}/${encodeURIComponent(secret.phoneNumberId)}/messages`,
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${secret.accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          recipient_type: 'individual',
          to: job.recipientAddresses[0]?.replace(/^\+/, ''),
          ...providerMessage,
        }),
      },
      [200],
    );
    const sent = await readJson<{ messages?: Array<{ id?: string }> }>(
      'WHATSAPP_CLOUD',
      response,
    );
    return {
      provider: 'whatsapp_business',
      messageId: safeProviderId(sent.messages?.[0]?.id ?? ''),
    };
  }

  verifySignature(
    context: ProviderRuntimeContext,
    rawBody: Buffer,
    suppliedSignature: string | undefined,
  ): boolean {
    if (!suppliedSignature?.startsWith('sha256=')) return false;
    const supplied = suppliedSignature.slice(7);
    if (!/^[0-9a-f]{64}$/i.test(supplied)) return false;
    const expected = createHmac('sha256', this.secret(context).appSecret)
      .update(rawBody)
      .digest();
    const actual = Buffer.from(supplied, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }

  verifyToken(context: ProviderRuntimeContext, token: string): boolean {
    const expected = Buffer.from(this.secret(context).verifyToken, 'utf8');
    const supplied = Buffer.from(token, 'utf8');
    return (
      supplied.length === expected.length && timingSafeEqual(supplied, expected)
    );
  }

  private secret(context: ProviderRuntimeContext): WhatsAppProviderSecret {
    return this.secrets.resolve(context.secretReference, 'WHATSAPP_BUSINESS');
  }
}
