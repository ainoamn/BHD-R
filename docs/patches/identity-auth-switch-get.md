# Patch for ONE-BHD — GET `/api/auth/switch` (product header switch)

Products cannot `fetch` identity APIs (CORP same-origin + JSON CORS). They need a **top-level GET** that switches `bhd_id` then redirects back to the product `start` URL.

Add this `GET` handler next to the existing `POST` in  
`app/api/auth/switch/route.ts` on identity (`id.bhd-om.com`):

```ts
export async function GET(request: Request) {
  const url = new URL(request.url);
  const sub = (url.searchParams.get('sub') || '').trim();
  const returnTo = url.searchParams.get('return_to') || '/';
  const safeReturn =
    returnTo.startsWith('https://') &&
    (() => {
      try {
        const target = new URL(returnTo);
        return (
          target.hostname === 'r.bhd-om.com' ||
          target.hostname.endsWith('.bhd-om.com') ||
          target.hostname === 'localhost'
        );
      } catch {
        return false;
      }
    })();

  if (!sub) {
    return NextResponse.redirect(new URL('/login', url.origin), 303);
  }

  const roster = await readSessionRoster();
  const target = roster.find((item) => item.sub === sub);
  if (!target) {
    return NextResponse.redirect(new URL('/login?add=1', url.origin), 303);
  }

  const destination = safeReturn ? returnTo : '/';
  const response = NextResponse.redirect(destination, 303);
  await applyIdentitySwitch(response.cookies, sub, roster);
  return response;
}
```

Until this is deployed on identity, BHD R still offers «إضافة حساب» and opens identity for switch with a clear message when GET returns 405.
