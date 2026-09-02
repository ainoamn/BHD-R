# Handoff — 0.4.32 guest trip lookup + header alerts

**Date:** 2026-09-02  
**Release:** 0.4.32  
**Production:** https://r.bhd-om.com  

## Root cause

Browser lookup used Nest BFF `/api/backend/v1/public/stays/bookings/lookup` which returned **HTTP 200 with empty body**, so the client threw `invalid_json` («رد غير صالح من خادم الحجز»).

## Fix

- Neon routes: lookup / claim / mine under `/api/public/stays/bookings/*`
- Header bell (`HeaderStayAlerts`) + localStorage memory of recent trips
- Auto-lookup on `/guest/stays?ref=`

## Verify

1. https://r.bhd-om.com/ar/guest/stays?ref=ST-BAD02106
2. Header bell shows booking + payment_pending
