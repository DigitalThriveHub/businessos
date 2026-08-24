function onFormSubmit(e) {
  const properties = PropertiesService.getScriptProperties();
  const apiUrl = properties.getProperty('BUSINESSOS_API_URL');
  const connectionId = properties.getProperty('BUSINESSOS_CONNECTION_ID');
  const secret = properties.getProperty('BUSINESSOS_SIGNING_SECRET');
  if (!apiUrl || !connectionId || !secret) throw new Error('BusinessOS configuration is incomplete.');
  const values = e.namedValues || {};
  const one = (name) => String((values[name] || [''])[0]).trim();
  const payload = {
    firstName: one('First name'), lastName: one('Last name') || undefined,
    email: one('Email') || undefined, phone: one('Phone') || undefined,
    country: one('Country') || undefined, serviceType: one('Service required') || undefined,
    message: one('Message') || undefined, priority: 'NORMAL', lawfulBasis: 'CONSENT',
    privacyNoticeAcknowledged: one('Privacy acknowledgement') === 'Yes',
    privacyNoticeVersion: properties.getProperty('BUSINESSOS_PRIVACY_VERSION'),
    marketingConsent: one('Marketing consent') === 'Yes',
    marketingConsentCapturedAt: one('Marketing consent') === 'Yes' ? new Date().toISOString() : undefined
  };
  const body = JSON.stringify(payload);
  const eventId = e.response ? e.response.getId() : Utilities.getUuid();
  const timestamp = String(Math.floor(Date.now() / 1000));
  const material = timestamp + '.' + eventId + '.' + body;
  const bytes = Utilities.computeHmacSha256Signature(material, secret);
  const signature = bytes.map((b) => ('0' + (b & 255).toString(16)).slice(-2)).join('');
  const response = UrlFetchApp.fetch(apiUrl.replace(/\/$/, '') + '/api/v1/webhooks/intake/' + encodeURIComponent(connectionId), {
    method: 'post', contentType: 'application/json', payload: body, muteHttpExceptions: true,
    headers: { 'X-BusinessOS-Event-Id': eventId, 'X-BusinessOS-Event-Type': 'google-form.submitted',
      'X-BusinessOS-Timestamp': timestamp, 'X-BusinessOS-Signature': 'v1=' + signature }
  });
  if (response.getResponseCode() < 200 || response.getResponseCode() >= 300) throw new Error('BusinessOS rejected the form response.');
}
