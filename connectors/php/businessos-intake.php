<?php
declare(strict_types=1);

function businessos_send_enquiry(array $payload, array $config): array {
    $body = json_encode($payload, JSON_THROW_ON_ERROR | JSON_UNESCAPED_SLASHES);
    $eventId = $config['event_id'] ?? bin2hex(random_bytes(16));
    $timestamp = (string) time();
    $material = $timestamp . '.' . $eventId . '.' . $body;
    $signature = hash_hmac('sha256', $material, $config['signing_secret']);
    $url = rtrim($config['api_url'], '/') . '/api/v1/webhooks/intake/' . rawurlencode($config['connection_id']);

    $ch = curl_init($url);
    curl_setopt_array($ch, [
        CURLOPT_POST => true,
        CURLOPT_RETURNTRANSFER => true,
        CURLOPT_TIMEOUT => 15,
        CURLOPT_CONNECTTIMEOUT => 5,
        CURLOPT_HTTPHEADER => [
            'Content-Type: application/json',
            'X-BusinessOS-Event-Id: ' . $eventId,
            'X-BusinessOS-Event-Type: enquiry.submitted',
            'X-BusinessOS-Timestamp: ' . $timestamp,
            'X-BusinessOS-Signature: v1=' . $signature,
        ],
        CURLOPT_POSTFIELDS => $body,
        CURLOPT_SSL_VERIFYPEER => true,
        CURLOPT_SSL_VERIFYHOST => 2,
    ]);
    $responseBody = curl_exec($ch);
    if ($responseBody === false) throw new RuntimeException('BusinessOS connection failed.');
    $status = (int) curl_getinfo($ch, CURLINFO_RESPONSE_CODE);
    curl_close($ch);
    if ($status < 200 || $status >= 300) throw new RuntimeException('BusinessOS rejected the submission.');
    return json_decode($responseBody, true, 32, JSON_THROW_ON_ERROR);
}
