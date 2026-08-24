<?php
/** Plugin Name: BusinessOS Secure Intake */
declare(strict_types=1);

function businessos_send_enquiry(array $payload, array $config): array {
    $body = wp_json_encode($payload, JSON_UNESCAPED_SLASHES);
    $eventId = wp_generate_uuid4();
    $timestamp = (string) time();
    $signature = hash_hmac('sha256', $timestamp . '.' . $eventId . '.' . $body, $config['signing_secret']);
    $response = wp_remote_post(rtrim($config['api_url'], '/') . '/api/v1/webhooks/intake/' . rawurlencode($config['connection_id']), [
        'timeout' => 15,
        'headers' => ['Content-Type' => 'application/json', 'X-BusinessOS-Event-Id' => $eventId,
            'X-BusinessOS-Event-Type' => 'wordpress.enquiry.submitted', 'X-BusinessOS-Timestamp' => $timestamp,
            'X-BusinessOS-Signature' => 'v1=' . $signature],
        'body' => $body,
    ]);
    if (is_wp_error($response) || wp_remote_retrieve_response_code($response) < 200 || wp_remote_retrieve_response_code($response) >= 300) {
        throw new RuntimeException('BusinessOS rejected the submission.');
    }
    return json_decode(wp_remote_retrieve_body($response), true, 32, JSON_THROW_ON_ERROR);
}

function businessos_intake_config(): array {
    return [
        'api_url' => defined('BUSINESSOS_API_URL') ? BUSINESSOS_API_URL : '',
        'connection_id' => defined('BUSINESSOS_CONNECTION_ID') ? BUSINESSOS_CONNECTION_ID : '',
        'signing_secret' => defined('BUSINESSOS_SIGNING_SECRET') ? BUSINESSOS_SIGNING_SECRET : '',
    ];
}

function businessos_normalise_fields(array $fields): array {
    $normalised = [];
    foreach ($fields as $key => $value) {
        if (is_array($value)) $value = implode(', ', array_map('strval', $value));
        if (!is_scalar($value)) continue;
        $normalised[strtolower(str_replace([' ', '-'], '_', (string) $key))] = trim((string) $value);
    }
    $first = static function (array $keys) use ($normalised): string {
        foreach ($keys as $key) if (!empty($normalised[$key])) return $normalised[$key];
        return '';
    };
    $truthy = static function (array $keys) use ($first): bool {
        return in_array(strtolower($first($keys)), ['1', 'yes', 'true', 'on', 'accepted', 'i agree'], true);
    };
    $payload = [
        'firstName' => sanitize_text_field($first(['first_name', 'firstname', 'given_name'])),
        'lastName' => sanitize_text_field($first(['last_name', 'lastname', 'family_name'])),
        'email' => sanitize_email($first(['email', 'email_address', 'your_email'])),
        'phone' => sanitize_text_field($first(['phone', 'telephone', 'mobile', 'phone_number'])),
        'country' => sanitize_text_field($first(['country', 'country_name'])),
        'serviceType' => sanitize_text_field($first(['service_type', 'service_required', 'service'])),
        'message' => sanitize_textarea_field($first(['message', 'your_message', 'enquiry', 'comments'])),
        'priority' => 'NORMAL',
        'lawfulBasis' => 'CONSENT',
        'privacyNoticeAcknowledged' => $truthy(['privacy_acknowledged', 'privacy_notice', 'privacy_consent', 'acceptance']),
        'privacyNoticeVersion' => defined('BUSINESSOS_PRIVACY_VERSION') ? BUSINESSOS_PRIVACY_VERSION : '',
        'marketingConsent' => $truthy(['marketing_consent', 'email_marketing', 'marketing']),
    ];
    if ($payload['marketingConsent']) $payload['marketingConsentCapturedAt'] = gmdate('c');
    return array_filter($payload, static fn($value): bool => $value !== '');
}

add_action('rest_api_init', function (): void {
    register_rest_route('businessos/v1', '/enquiries', [
        'methods' => 'POST',
        'permission_callback' => '__return_true',
        'callback' => function (WP_REST_Request $request) {
            $data = $request->get_json_params();
            if (!is_array($data)) return new WP_Error('invalid_payload', 'Invalid request.', ['status' => 400]);
            try {
                return rest_ensure_response(businessos_send_enquiry($data, businessos_intake_config()));
            } catch (Throwable $error) {
                return new WP_Error('delivery_failed', 'The enquiry could not be delivered.', ['status' => 502]);
            }
        },
    ]);
]);

// Elementor Pro: map field IDs to the canonical BusinessOS contract.
add_action('elementor_pro/forms/new_record', function ($record): void {
    $fields = [];
    foreach ($record->get('fields') as $id => $field) $fields[$id] = $field['value'] ?? '';
    businessos_send_enquiry(businessos_normalise_fields($fields), businessos_intake_config());
}, 10, 1);

// Contact Form 7.
add_action('wpcf7_before_send_mail', function (): void {
    if (!class_exists('WPCF7_Submission')) return;
    $submission = WPCF7_Submission::get_instance();
    if ($submission) businessos_send_enquiry(
        businessos_normalise_fields((array) $submission->get_posted_data()),
        businessos_intake_config()
    );
});

// WPForms. Field labels and explicit field keys are both supported.
add_action('wpforms_process_complete', function ($fields): void {
    $values = [];
    foreach ((array) $fields as $field) {
        if (!is_array($field)) continue;
        $key = (string) ($field['name'] ?? $field['id'] ?? '');
        if ($key !== '') $values[$key] = $field['value'] ?? '';
    }
    businessos_send_enquiry(businessos_normalise_fields($values), businessos_intake_config());
}, 10, 1);

// Gravity Forms. Labels are used as canonical mapping keys.
add_action('gform_after_submission', function ($entry, $form): void {
    $values = [];
    foreach ((array) ($form['fields'] ?? []) as $field) {
        $id = (string) ($field->id ?? '');
        $label = (string) ($field->inputName ?? $field->label ?? $id);
        if ($id !== '') $values[$label] = $entry[$id] ?? '';
    }
    businessos_send_enquiry(businessos_normalise_fields($values), businessos_intake_config());
}, 10, 2);
