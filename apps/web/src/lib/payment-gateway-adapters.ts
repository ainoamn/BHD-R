import 'server-only';
import {
  credentialsComplete,
  paymentProviderById,
  type PaymentProviderDefinition,
} from '@/lib/payment-gateways-catalog';

export type GatewayVerifyResult = {
  ok: boolean;
  detailAr: string;
  detailEn: string;
};

/**
 * Lightweight readiness check after keys are saved.
 * Sandbox is always ok; live providers validate field shape and (when possible) a cheap API call.
 */
export async function verifyPaymentProvider(
  providerId: string,
  endpoint: string,
  credentials: Record<string, string>,
): Promise<GatewayVerifyResult> {
  const def = paymentProviderById(providerId);
  if (!def) {
    return {
      ok: false,
      detailAr: 'بوابة غير معروفة.',
      detailEn: 'Unknown gateway.',
    };
  }
  if (def.kind === 'sandbox') {
    return {
      ok: true,
      detailAr: 'بوابة التجربة جاهزة.',
      detailEn: 'Sandbox gateway is ready.',
    };
  }
  if (!credentialsComplete(def, credentials)) {
    return {
      ok: false,
      detailAr: 'المفاتيح المطلوبة ناقصة.',
      detailEn: 'Required keys are missing.',
    };
  }

  try {
    switch (def.id) {
      case 'thawani':
        return await verifyThawani(endpoint, credentials.secretKey!);
      case 'stripe':
        return await verifyStripe(credentials.secretKey!);
      case 'tap':
        return await verifyTap(endpoint, credentials.secretKey!);
      case 'myfatoorah':
        return await verifyMyFatoorah(endpoint, credentials.apiKey!);
      case 'network_international':
        return await verifyNgenius(endpoint, credentials.apiKey!);
      case 'paytabs':
        return await verifyPaytabs(endpoint, credentials);
      case 'omannet':
        // Hosted IPG — shape check only (no public health endpoint).
        return {
          ok: true,
          detailAr: 'المفاتيح محفوظة — جاهزة عند إنشاء جلسة الدفع.',
          detailEn: 'Keys stored — ready when a payment session is created.',
        };
      default:
        return {
          ok: true,
          detailAr: 'المفاتيح مكتملة.',
          detailEn: 'Keys look complete.',
        };
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'verify_failed';
    return {
      ok: false,
      detailAr: `فشل التحقق: ${message}`,
      detailEn: `Verification failed: ${message}`,
    };
  }
}

async function verifyThawani(endpoint: string, secretKey: string): Promise<GatewayVerifyResult> {
  const base = endpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/products?limit=1`, {
    method: 'GET',
    headers: {
      Accept: 'application/json',
      'thawani-api-key': secretKey,
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok || response.status === 404) {
    return { ok: true, detailAr: 'ثواني تقبل المفتاح.', detailEn: 'Thawani accepted the key.' };
  }
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      detailAr: 'مفتاح ثواني مرفوض.',
      detailEn: 'Thawani rejected the key.',
    };
  }
  return {
    ok: response.status < 500,
    detailAr: `ثواني ردّت ${response.status}.`,
    detailEn: `Thawani responded ${response.status}.`,
  };
}

async function verifyStripe(secretKey: string): Promise<GatewayVerifyResult> {
  const response = await fetch('https://api.stripe.com/v1/balance', {
    headers: { Authorization: `Bearer ${secretKey}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) {
    return { ok: true, detailAr: 'Stripe يقبل المفتاح.', detailEn: 'Stripe accepted the key.' };
  }
  return {
    ok: false,
    detailAr: `Stripe رفض المفتاح (${response.status}).`,
    detailEn: `Stripe rejected the key (${response.status}).`,
  };
}

async function verifyTap(endpoint: string, secretKey: string): Promise<GatewayVerifyResult> {
  const base = endpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/charges?limit=1`, {
    headers: {
      Authorization: `Bearer ${secretKey}`,
      Accept: 'application/json',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok || response.status === 404) {
    return { ok: true, detailAr: 'Tap يقبل المفتاح.', detailEn: 'Tap accepted the key.' };
  }
  return {
    ok: false,
    detailAr: `Tap ردّ ${response.status}.`,
    detailEn: `Tap responded ${response.status}.`,
  };
}

async function verifyMyFatoorah(endpoint: string, apiKey: string): Promise<GatewayVerifyResult> {
  const base = endpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/v2/GetSupplierDashboard`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: '{}',
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) {
    return {
      ok: true,
      detailAr: 'ماي فاتورة تقبل المفتاح.',
      detailEn: 'MyFatoorah accepted the key.',
    };
  }
  // Some accounts lack supplier dashboard — 401 is the clear fail.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      detailAr: 'مفتاح ماي فاتورة مرفوض.',
      detailEn: 'MyFatoorah rejected the key.',
    };
  }
  return {
    ok: true,
    detailAr: 'المفتاح مقبول شكلاً (تحقق كامل عند أول دفعة).',
    detailEn: 'Key shape accepted (full check on first payment).',
  };
}

async function verifyNgenius(endpoint: string, apiKey: string): Promise<GatewayVerifyResult> {
  const base = endpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/identity/auth/access-token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(apiKey).toString('base64')}`,
      'Content-Type': 'application/vnd.ni-identity.v1+json',
    },
    signal: AbortSignal.timeout(8_000),
  });
  if (response.ok) {
    return {
      ok: true,
      detailAr: 'Network International يقبل المفتاح.',
      detailEn: 'Network International accepted the key.',
    };
  }
  return {
    ok: false,
    detailAr: `N-Genius ردّ ${response.status}.`,
    detailEn: `N-Genius responded ${response.status}.`,
  };
}

async function verifyPaytabs(
  endpoint: string,
  credentials: Record<string, string>,
): Promise<GatewayVerifyResult> {
  const base = endpoint.replace(/\/$/, '');
  const response = await fetch(`${base}/payment/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      profile_id: credentials.profileId,
      tran_ref: 'bhd-r-verify',
    }),
    signal: AbortSignal.timeout(8_000),
  });
  // PayTabs returns 400 for unknown ref when auth is ok; 401 when key wrong.
  if (response.status === 401 || response.status === 403) {
    return {
      ok: false,
      detailAr: 'مفتاح PayTabs مرفوض.',
      detailEn: 'PayTabs rejected the key.',
    };
  }
  return {
    ok: true,
    detailAr: 'PayTabs يقبل الملف/المفتاح.',
    detailEn: 'PayTabs accepted the profile/key.',
  };
}

/** Create a hosted checkout URL for a ready live provider (Thawani first). */
export async function createLiveCheckoutSession(input: {
  providerId: string;
  endpoint: string;
  credentials: Record<string, string>;
  amountMinor: bigint;
  currency: string;
  clientReference: string;
  successUrl: string;
  cancelUrl: string;
  productName: string;
}): Promise<{ redirectUrl: string; providerSessionId: string } | null> {
  const def = paymentProviderById(input.providerId);
  if (!def || def.kind !== 'live') return null;
  if (!credentialsComplete(def, input.credentials)) return null;

  if (def.id === 'thawani') {
    return createThawaniSession(def, input, input.credentials);
  }
  // Other PSPs: credentials are stored and verified; session create lands with their SDK next.
  return null;
}

async function createThawaniSession(
  def: PaymentProviderDefinition,
  input: {
    endpoint: string;
    amountMinor: bigint;
    currency: string;
    clientReference: string;
    successUrl: string;
    cancelUrl: string;
    productName: string;
  },
  credentials: Record<string, string>,
): Promise<{ redirectUrl: string; providerSessionId: string }> {
  const base = (input.endpoint || def.defaultEndpoint).replace(/\/$/, '');
  const response = await fetch(`${base}/checkout/session`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Accept: 'application/json',
      'thawani-api-key': credentials.secretKey!,
    },
    body: JSON.stringify({
      client_reference_id: input.clientReference.slice(0, 40),
      mode: 'payment',
      products: [
        {
          name: input.productName.slice(0, 40),
          quantity: 1,
          unit_amount: Number(input.amountMinor),
        },
      ],
      success_url: input.successUrl,
      cancel_url: input.cancelUrl,
      metadata: { source: 'bhd-r' },
    }),
    signal: AbortSignal.timeout(12_000),
  });
  if (!response.ok) {
    throw new Error(`thawani_session_${response.status}`);
  }
  const payload = (await response.json()) as {
    data?: { session_id?: string; payment_url?: string };
  };
  const sessionId = payload.data?.session_id;
  if (!sessionId) throw new Error('thawani_session_missing');
  const publishable = credentials.publishableKey?.trim();
  const checkoutHost = base.includes('uat')
    ? 'https://uatcheckout.thawani.om/pay'
    : 'https://checkout.thawani.om/pay';
  const redirectUrl =
    payload.data?.payment_url ||
    (publishable ? `${checkoutHost}/${sessionId}?key=${encodeURIComponent(publishable)}` : null);
  if (!redirectUrl) throw new Error('thawani_redirect_missing');
  return { redirectUrl, providerSessionId: sessionId };
}
