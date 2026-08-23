<?php
/**
 * Plugin Name: BusinessOS Secure Intake
 * Description: Sends privacy-controlled WordPress enquiries to BusinessOS using a server-side signed webhook.
 * Version: 1.0.0
 * Requires at least: 6.4
 * Requires PHP: 8.1
 * Author: BusinessOS
 * License: Proprietary
 * Text Domain: businessos-secure-intake
 */

declare(strict_types=1);

if (!defined('ABSPATH')) {
    exit;
}

final class BusinessOS_Secure_Intake
{
    private const SHORTCODE = 'businessos_enquiry_form';
    private const ACTION = 'businessos_submit_enquiry';
    private const NONCE_NAME = 'businessos_intake_nonce';
    private const MAX_REQUEST_BYTES = 65536;
    private const RATE_LIMIT = 5;
    private const RATE_WINDOW_SECONDS = 600;

    /** @var array<string, string> */
    private const LAWFUL_BASES = array(
        'CONSENT' => 'CONSENT',
        'CONTRACT' => 'CONTRACT',
        'LEGAL_OBLIGATION' => 'LEGAL_OBLIGATION',
        'LEGITIMATE_INTEREST' => 'LEGITIMATE_INTEREST',
    );

    public static function boot(): void
    {
        add_shortcode(self::SHORTCODE, array(self::class, 'render'));
        add_action('admin_notices', array(self::class, 'configuration_notice'));
    }

    public static function configuration_notice(): void
    {
        if (!current_user_can('manage_options')) {
            return;
        }

        $errors = self::configuration_errors();
        if ($errors === array()) {
            return;
        }

        printf(
            '<div class="notice notice-error"><p>%s</p></div>',
            esc_html(
                sprintf(
                    /* translators: %s is a comma-separated list of configuration errors. */
                    __('BusinessOS Secure Intake is disabled: %s', 'businessos-secure-intake'),
                    implode(', ', $errors)
                )
            )
        );
    }

    /**
     * @param array<string, mixed> $attributes
     */
    public static function render(array $attributes = array()): string
    {
        $attributes = shortcode_atts(
            array(
                'service_type' => '',
                'button_label' => __('Send secure enquiry', 'businessos-secure-intake'),
            ),
            $attributes,
            self::SHORTCODE
        );

        $result = null;
        if (self::is_submission()) {
            $result = self::process_submission();
        }

        $event_id = self::posted_text('businessos_event_id', 36);
        if (
            !wp_is_uuid($event_id) ||
            (is_array($result) && $result['ok'])
        ) {
            $event_id = wp_generate_uuid4();
        }

        $privacy_url = self::constant_string('BUSINESSOS_PRIVACY_NOTICE_URL');
        $configured = self::configuration_errors() === array();

        ob_start();
        ?>
        <section class="businessos-secure-intake" aria-labelledby="businessos-intake-title">
            <h2 id="businessos-intake-title">
                <?php echo esc_html__('Make an enquiry', 'businessos-secure-intake'); ?>
            </h2>

            <?php if (is_array($result)) : ?>
                <div
                    class="businessos-intake-message businessos-intake-message--<?php echo $result['ok'] ? 'success' : 'error'; ?>"
                    role="<?php echo $result['ok'] ? 'status' : 'alert'; ?>"
                >
                    <?php echo esc_html($result['message']); ?>
                </div>
            <?php endif; ?>

            <?php if (!$configured) : ?>
                <p role="alert">
                    <?php echo esc_html__('Secure enquiries are temporarily unavailable. Please contact us by telephone.', 'businessos-secure-intake'); ?>
                </p>
            <?php else : ?>
                <form method="post" action="<?php echo esc_url(self::current_url()); ?>" novalidate>
                    <?php wp_nonce_field(self::ACTION, self::NONCE_NAME); ?>
                    <input type="hidden" name="businessos_action" value="<?php echo esc_attr(self::ACTION); ?>">
                    <input type="hidden" name="businessos_event_id" value="<?php echo esc_attr($event_id); ?>">

                    <p class="businessos-field businessos-field--trap" aria-hidden="true">
                        <label>
                            <?php echo esc_html__('Leave this field empty', 'businessos-secure-intake'); ?>
                            <input type="text" name="businessos_company_website" value="" tabindex="-1" autocomplete="off">
                        </label>
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-first-name">
                            <?php echo esc_html__('First name', 'businessos-secure-intake'); ?> <span aria-hidden="true">*</span>
                        </label>
                        <input id="businessos-first-name" name="businessos_first_name" type="text" maxlength="100" autocomplete="given-name" required value="<?php echo esc_attr(self::retained_value($result, 'businessos_first_name')); ?>">
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-last-name">
                            <?php echo esc_html__('Last name', 'businessos-secure-intake'); ?>
                        </label>
                        <input id="businessos-last-name" name="businessos_last_name" type="text" maxlength="100" autocomplete="family-name" value="<?php echo esc_attr(self::retained_value($result, 'businessos_last_name')); ?>">
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-email">
                            <?php echo esc_html__('Email address', 'businessos-secure-intake'); ?>
                        </label>
                        <input id="businessos-email" name="businessos_email" type="email" maxlength="320" autocomplete="email" value="<?php echo esc_attr(self::retained_value($result, 'businessos_email')); ?>">
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-phone">
                            <?php echo esc_html__('Telephone', 'businessos-secure-intake'); ?>
                        </label>
                        <input id="businessos-phone" name="businessos_phone" type="tel" maxlength="50" autocomplete="tel" value="<?php echo esc_attr(self::retained_value($result, 'businessos_phone')); ?>">
                        <small><?php echo esc_html__('Enter at least an email address or telephone number.', 'businessos-secure-intake'); ?></small>
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-country">
                            <?php echo esc_html__('Country', 'businessos-secure-intake'); ?>
                        </label>
                        <input id="businessos-country" name="businessos_country" type="text" maxlength="100" autocomplete="country-name" value="<?php echo esc_attr(self::retained_value($result, 'businessos_country')); ?>">
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-service-type">
                            <?php echo esc_html__('Service required', 'businessos-secure-intake'); ?>
                        </label>
                        <input id="businessos-service-type" name="businessos_service_type" type="text" maxlength="160" value="<?php echo esc_attr(self::retained_value($result, 'businessos_service_type', (string) $attributes['service_type'])); ?>">
                    </p>

                    <p class="businessos-field">
                        <label for="businessos-message">
                            <?php echo esc_html__('How can we help?', 'businessos-secure-intake'); ?>
                        </label>
                        <textarea id="businessos-message" name="businessos_message" maxlength="10000" rows="7"><?php echo esc_textarea(self::retained_value($result, 'businessos_message')); ?></textarea>
                    </p>

                    <p class="businessos-field businessos-field--checkbox">
                        <label>
                            <input name="businessos_privacy_acknowledged" type="checkbox" value="1" required <?php checked(self::retained_checkbox($result, 'businessos_privacy_acknowledged')); ?>>
                            <?php
                            printf(
                                wp_kses(
                                    /* translators: %s is the privacy notice URL. */
                                    __('I have read the <a href="%s" target="_blank" rel="noopener noreferrer">privacy notice</a> and understand how my enquiry will be handled.', 'businessos-secure-intake'),
                                    array(
                                        'a' => array(
                                            'href' => true,
                                            'target' => true,
                                            'rel' => true,
                                        ),
                                    )
                                ),
                                esc_url($privacy_url)
                            );
                            ?>
                        </label>
                    </p>

                    <p class="businessos-field businessos-field--checkbox">
                        <label>
                            <input name="businessos_marketing_consent" type="checkbox" value="1" <?php checked(self::retained_checkbox($result, 'businessos_marketing_consent')); ?>>
                            <?php echo esc_html__('I would also like to receive optional news and marketing. I can withdraw this consent at any time.', 'businessos-secure-intake'); ?>
                        </label>
                    </p>

                    <button type="submit">
                        <?php echo esc_html((string) $attributes['button_label']); ?>
                    </button>
                </form>
            <?php endif; ?>
        </section>
        <?php

        return (string) ob_get_clean();
    }

    /**
     * @return array{ok: bool, message: string, retain: bool}
     */
    private static function process_submission(): array
    {
        if (self::posted_text('businessos_company_website', 200) !== '') {
            return self::success_result();
        }

        $nonce = self::posted_text(self::NONCE_NAME, 128);
        if ($nonce === '' || !wp_verify_nonce($nonce, self::ACTION)) {
            return self::error_result(__('Your security token expired. Refresh the page and try again.', 'businessos-secure-intake'));
        }

        if (self::configuration_errors() !== array()) {
            return self::error_result(__('Secure enquiries are temporarily unavailable. Please contact us by telephone.', 'businessos-secure-intake'));
        }

        $first_name = self::posted_text('businessos_first_name', 100);
        $last_name = self::posted_text('businessos_last_name', 100);
        $email = sanitize_email(self::posted_text('businessos_email', 320));
        $phone = self::normalise_phone(self::posted_text('businessos_phone', 50));
        $country = self::posted_text('businessos_country', 100);
        $service_type = self::posted_text('businessos_service_type', 160);
        $message = self::posted_textarea('businessos_message', 10000);
        $privacy_acknowledged = self::posted_checkbox('businessos_privacy_acknowledged');
        $marketing_consent = self::posted_checkbox('businessos_marketing_consent');

        if ($first_name === '') {
            return self::error_result(__('Enter your first name.', 'businessos-secure-intake'));
        }
        if ($email === '' && $phone === '') {
            return self::error_result(__('Enter a valid email address or telephone number.', 'businessos-secure-intake'));
        }
        if ($email !== '' && !is_email($email)) {
            return self::error_result(__('Enter a valid email address.', 'businessos-secure-intake'));
        }
        if (!$privacy_acknowledged) {
            return self::error_result(__('Confirm that you have read the privacy notice.', 'businessos-secure-intake'));
        }

        if (!self::consume_rate_limit()) {
            return self::error_result(__('Too many enquiries were submitted from this connection. Wait ten minutes and try again.', 'businessos-secure-intake'));
        }

        $payload = array(
            'firstName' => $first_name,
            'priority' => 'NORMAL',
            'lawfulBasis' => self::constant_string('BUSINESSOS_INTAKE_LAWFUL_BASIS'),
            'privacyNoticeAcknowledged' => true,
            'privacyNoticeVersion' => self::constant_string('BUSINESSOS_PRIVACY_NOTICE_VERSION'),
            'marketingConsent' => $marketing_consent,
        );

        foreach (
            array(
                'lastName' => $last_name,
                'email' => $email,
                'phone' => $phone,
                'country' => $country,
                'serviceType' => $service_type,
                'message' => $message,
            ) as $field => $value
        ) {
            if ($value !== '') {
                $payload[$field] = $value;
            }
        }

        if ($marketing_consent) {
            $payload['marketingConsentCapturedAt'] = gmdate('c');
        }

        $json = wp_json_encode($payload, JSON_UNESCAPED_SLASHES | JSON_UNESCAPED_UNICODE);
        if (!is_string($json) || strlen($json) > self::MAX_REQUEST_BYTES) {
            return self::error_result(__('Your enquiry is too large to send securely.', 'businessos-secure-intake'));
        }

        $event_uuid = self::posted_text('businessos_event_id', 36);
        if (!wp_is_uuid($event_uuid)) {
            $event_uuid = wp_generate_uuid4();
        }
        $event_id = 'wordpress/enquiry/' . $event_uuid;
        $timestamp = (string) time();
        $signature = hash_hmac(
            'sha256',
            $timestamp . '.' . $event_id . '.' . $json,
            self::constant_string('BUSINESSOS_INTAKE_SIGNING_SECRET')
        );

        $response = wp_safe_remote_post(
            self::endpoint(),
            array(
                'body' => $json,
                'headers' => array(
                    'Accept' => 'application/json',
                    'Content-Type' => 'application/json',
                    'x-businessos-event-id' => $event_id,
                    'x-businessos-event-type' => 'enquiry.created',
                    'x-businessos-timestamp' => $timestamp,
                    'x-businessos-signature' => 'v1=' . $signature,
                ),
                'redirection' => 0,
                'reject_unsafe_urls' => true,
                'sslverify' => true,
                'timeout' => 15,
            )
        );

        if (is_wp_error($response)) {
            return self::error_result(__('We could not send your enquiry securely. Please try again or contact us by telephone.', 'businessos-secure-intake'));
        }

        $status = wp_remote_retrieve_response_code($response);
        $response_body = json_decode(wp_remote_retrieve_body($response), true);
        if (
            $status !== 202 ||
            !is_array($response_body) ||
            ($response_body['accepted'] ?? false) !== true
        ) {
            return self::error_result(__('We could not accept your enquiry. Please try again or contact us by telephone.', 'businessos-secure-intake'));
        }

        return self::success_result();
    }

    /** @return array{ok: bool, message: string, retain: bool} */
    private static function success_result(): array
    {
        return array(
            'ok' => true,
            'message' => __('Your enquiry was sent securely. A team member will contact you.', 'businessos-secure-intake'),
            'retain' => false,
        );
    }

    /** @return array{ok: bool, message: string, retain: bool} */
    private static function error_result(string $message): array
    {
        return array('ok' => false, 'message' => $message, 'retain' => true);
    }

    private static function is_submission(): bool
    {
        return ($_SERVER['REQUEST_METHOD'] ?? '') === 'POST'
            && self::posted_text('businessos_action', 80) === self::ACTION;
    }

    private static function current_url(): string
    {
        $path = isset($_SERVER['REQUEST_URI'])
            ? wp_unslash((string) $_SERVER['REQUEST_URI'])
            : '/';

        return home_url(strtok($path, '?') ?: '/');
    }

    /** @return list<string> */
    private static function configuration_errors(): array
    {
        $errors = array();
        $api_url = self::constant_string('BUSINESSOS_INTAKE_API_URL');
        $connection_id = self::constant_string('BUSINESSOS_INTAKE_CONNECTION_ID');
        $signing_secret = self::constant_string('BUSINESSOS_INTAKE_SIGNING_SECRET');
        $privacy_url = self::constant_string('BUSINESSOS_PRIVACY_NOTICE_URL');
        $privacy_version = self::constant_string('BUSINESSOS_PRIVACY_NOTICE_VERSION');
        $lawful_basis = self::constant_string('BUSINESSOS_INTAKE_LAWFUL_BASIS');

        if (
            $api_url === '' ||
            wp_parse_url($api_url, PHP_URL_SCHEME) !== 'https' ||
            !wp_http_validate_url($api_url)
        ) {
            $errors[] = 'BUSINESSOS_INTAKE_API_URL must be a valid HTTPS URL';
        }
        if (!wp_is_uuid($connection_id)) {
            $errors[] = 'BUSINESSOS_INTAKE_CONNECTION_ID must be a UUID';
        }
        if (strlen($signing_secret) < 32) {
            $errors[] = 'BUSINESSOS_INTAKE_SIGNING_SECRET is missing or invalid';
        }
        if (
            $privacy_url === '' ||
            wp_parse_url($privacy_url, PHP_URL_SCHEME) !== 'https' ||
            !wp_http_validate_url($privacy_url)
        ) {
            $errors[] = 'BUSINESSOS_PRIVACY_NOTICE_URL must be a valid HTTPS URL';
        }
        if ($privacy_version === '' || strlen($privacy_version) > 80) {
            $errors[] = 'BUSINESSOS_PRIVACY_NOTICE_VERSION is missing or invalid';
        }
        if (!isset(self::LAWFUL_BASES[$lawful_basis])) {
            $errors[] = 'BUSINESSOS_INTAKE_LAWFUL_BASIS is missing or invalid';
        }

        return $errors;
    }

    private static function endpoint(): string
    {
        return untrailingslashit(self::constant_string('BUSINESSOS_INTAKE_API_URL'))
            . '/api/v1/webhooks/intake/'
            . rawurlencode(self::constant_string('BUSINESSOS_INTAKE_CONNECTION_ID'));
    }

    private static function consume_rate_limit(): bool
    {
        $address = isset($_SERVER['REMOTE_ADDR'])
            ? (string) $_SERVER['REMOTE_ADDR']
            : 'unknown';
        $fingerprint = hash_hmac('sha256', $address, wp_salt('nonce'));
        $key = 'businessos_intake_' . substr($fingerprint, 0, 32);
        $attempts = (int) get_transient($key);

        if ($attempts >= self::RATE_LIMIT) {
            return false;
        }

        set_transient($key, $attempts + 1, self::RATE_WINDOW_SECONDS);
        return true;
    }

    private static function normalise_phone(string $value): string
    {
        return substr((string) preg_replace('/[^0-9+() .-]/', '', $value), 0, 50);
    }

    private static function constant_string(string $name): string
    {
        if (!defined($name)) {
            return '';
        }

        $value = constant($name);
        return is_string($value) ? trim($value) : '';
    }

    private static function posted_text(string $name, int $maximum_length): string
    {
        if (!isset($_POST[$name]) || !is_scalar($_POST[$name])) {
            return '';
        }

        return substr(
            sanitize_text_field(wp_unslash((string) $_POST[$name])),
            0,
            $maximum_length
        );
    }

    private static function posted_textarea(string $name, int $maximum_length): string
    {
        if (!isset($_POST[$name]) || !is_scalar($_POST[$name])) {
            return '';
        }

        return substr(
            sanitize_textarea_field(wp_unslash((string) $_POST[$name])),
            0,
            $maximum_length
        );
    }

    private static function posted_checkbox(string $name): bool
    {
        return isset($_POST[$name]) && wp_unslash((string) $_POST[$name]) === '1';
    }

    /**
     * @param array{ok: bool, message: string, retain: bool}|null $result
     */
    private static function retained_value(?array $result, string $name, string $fallback = ''): string
    {
        if (!is_array($result) || !$result['retain']) {
            return $fallback;
        }

        return self::posted_textarea($name, $name === 'businessos_message' ? 10000 : 320);
    }

    /**
     * @param array{ok: bool, message: string, retain: bool}|null $result
     */
    private static function retained_checkbox(?array $result, string $name): bool
    {
        return is_array($result) && $result['retain'] && self::posted_checkbox($name);
    }
}

BusinessOS_Secure_Intake::boot();
